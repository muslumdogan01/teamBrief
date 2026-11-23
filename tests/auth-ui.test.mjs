import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { createServer } from 'vite'

test('sign-in errors, sign-out, account switching and delayed old data are handled by the UI', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost'})
  dom.window.scrollTo = () => {}
  const previous = new Map()
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  const {render,fireEvent,waitFor,cleanup,act,within} = await import('@testing-library/react')
  const server = await createServer({server:{middlewareMode:true,watch:null,ws:false},appType:'custom'})
  let listener
  let identity = null
  let delayed
  let delayOld = false
  let finishOldSearch
  const searchRequests = []
  const unassignedQueries = []
  const readBy = new Set()
  let manyUpdates = false
  let finishOldUpdateSearch
  let oldUpdateSignal
  const historicalUpdate = {
    id: 'update', person_label: 'Test guest', service_note: 'Resume normal service.',
    occurred_at: '2020-01-01', photo_path: null,
  }
  const olderUpdates = Array.from({ length: 20 }, (_, i) => ({
    ...historicalUpdate, id: `update-${i + 1}`, person_label: `History guest ${i + 1}`,
    photo_path: i === 0 ? 'missing-image' : i === 1 ? 'test-image' : null,
  }))
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const photoFile = new Blob([pngHeader], { type: 'image/png' })
  const statusReports = ['Awaiting guest', 'Overdue guest', 'Lifted guest', 'Reviewed guest'].map((label, index) => {
    const id = `report-${index}`
    const initialBan = {
      id: `decision-${index}`, report_id: id, kind: 'ban', explanation: 'Fictional decision reason',
      severity: 'medium', instruction: 'Do not serve', decided_at: '2020-01-02',
      review_at: '2020-01-03', lifted_at: null,
    }
    const decision = [[], [initialBan], [{ ...initialBan, lifted_at: '2020-01-04' }], [{ ...initialBan, kind: 'no-ban' }]][index]
    return { id, label, reported_by: 'status-manager', occurred_at: '2020-01-01', created_at: '2020-01-01',
      incident_type: 'other', severity: 'low', appearance: 'Fictional hat', description: 'Fictional report', decision, photo: [] }
  })
  const client = {
    storage: { from: () => ({
      download: async path => path === 'test-image'
        ? { data: photoFile, error: null }
        : { data: null, error: { message: 'Object not found' } },
    }) },
    auth: {
      onAuthStateChange(fn) { listener=fn; return {data:{subscription:{unsubscribe(){}}}} },
      async getSession() { return {data:{session:null},error:null} },
      async signInWithPassword({password}) { if(password==='wrong') return {error:{message:'Invalid login credentials'},data:null}; identity='one'; listener('SIGNED_IN',{user:{id:'one',email:'one@example.test'}}); return {data:{},error:null} },
      async signOut() { identity=null; listener('SIGNED_OUT',null); return {error:null} },
    },
    from(table) {
      const owner=identity
      if (owner === 'no-membership') unassignedQueries.push(table)
      const query={select(){return query},eq(){return query},order(){return query},limit(){return query},single(){return Promise.resolve({data:{display_name:owner},error:null})},then(resolve,reject){
        if(table==='incident_reports' && owner==='one' && delayOld) return new Promise(r=>{delayed=r}).then(resolve,reject)
        if (owner === 'status-manager' && table === 'incident_reports') return Promise.resolve({ data: statusReports, error: null }).then(resolve, reject)
        if (owner === 'status-manager' && table === 'decisions') {
          return Promise.resolve({ data: statusReports.flatMap(r => r.decision), error: null }).then(resolve, reject)
        }
        if (owner === 'missing-decision' && table === 'incident_reports') {
          return Promise.resolve({ data: [{ ...statusReports[0], decision: undefined }], error: null }).then(resolve, reject)
        }
        const data = table==='venue_memberships' ? (owner==='no-membership' ? [] : [{venue_id:'pub',role:owner === 'status-manager' ? 'manager' : 'staff',venues:{name:'Test Pub'}}]) : table==='incident_reports' ? [{id:owner,label:`PRIVATE_${owner}`,reported_by:owner,occurred_at:'2020-01-01',created_at:'2020-01-01',incident_type:'other',severity:'low',appearance:'Hat',description:`Description ${owner}`,decision:[],photo:[]}] : []
        return Promise.resolve({data,error:null}).then(resolve,reject)
      }}; return query
    },
    rpc(name, args) {
      if (name === 'get_teambrief_totals') {
        return { single: async () => ({ data: { active_bans: 37, my_incidents: 1, awaiting_review: null }, error: null }) }
      }
      if (name === 'find_active_bans') {
        return { abortSignal: signal => {
          searchRequests.push({ query: args.p_query, limit: args.p_limit, signal })
          if (args.p_query === 'old') return new Promise(resolve => { finishOldSearch = resolve })
          if (args.p_query === 'offline') return Promise.resolve({ data: null, error: { message: 'Connection unavailable' } })
          const ban = { decision_id: 'ban', report_id: 'report', severity: 'high', appearance: 'Blue hat',
            instruction: 'Do not serve', decided_at: '2020-01-02', review_at: '2020-01-03', photo_path: null }
          const data = args.p_query === 'fresh' ? [{ ...ban, label: 'Fresh result' }] : []
          return Promise.resolve({ data, error: null })
        } }
      }
      if (name === 'find_lift_updates') {
        return { abortSignal: signal => {
          if (args.p_query === 'old update search') {
            oldUpdateSignal = signal
            return new Promise(resolve => { finishOldUpdateSearch = resolve })
          }
          if (args.p_query === 'offline') return Promise.resolve({ data: null, error: { message: 'Offline' } })
          const all = manyUpdates ? [historicalUpdate, ...olderUpdates] : [historicalUpdate]
          const filtered = args.p_query === 'dotted scarf' ? [olderUpdates[19]] : args.p_query ? [] : all
          const start = args.p_before_id ? filtered.findIndex(row => row.id === args.p_before_id) + 1 : 0
          const data = filtered.slice(start, start + args.p_limit).map(row => ({
            ...row, has_more: filtered.length > start + args.p_limit,
            read_at: row.id === 'update' && readBy.has(identity) ? '2020-01-02' : null,
          }))
          return Promise.resolve({ data, error: null })
        } }
      }
      if (name === 'count_unread_lift_updates') {
        return { abortSignal: async () => ({ data: (manyUpdates ? 21 : 1) - Number(readBy.has(identity)), error: null }) }
      }
      return updatesRpc(name, args)
    },
  }
  async function updatesRpc(name, args) {
      if (name === 'mark_venue_update_read') {
        assert.deepEqual(args, { p_venue_id: 'pub', p_update_id: 'update' })
        readBy.add(identity)
      }
      return { data: [], error: null }
  }
  try {
    const {AuthApp} = await server.ssrLoadModule('/src/ConnectedApp.tsx')
    const ui=render(createElement(AuthApp,{client, environment:'Demo environment'}))
    await waitFor(()=>assert.ok(ui.queryByText('Sign in to TeamBrief')))
    assert.ok(ui.getByText('Demo environment'))
    fireEvent.change(ui.getByLabelText('Email'),{target:{value:'one@example.test'}})
    fireEvent.change(ui.getByLabelText('Password'),{target:{value:'wrong'}})
    fireEvent.click(ui.getByRole('button',{name:'Sign in'}))
    await waitFor(()=>assert.ok(ui.queryByRole('alert')?.textContent.includes('Invalid login credentials')))
    assert.equal(ui.queryByText('Saved successfully.'),null)
    fireEvent.change(ui.getByLabelText('Password'),{target:{value:'correct'}})
    fireEvent.click(ui.getByRole('button',{name:'Sign in'}))
    await waitFor(()=>assert.ok(ui.queryByRole('button',{name:'My Incidents'})))
    await waitFor(() => assert.ok(ui.getByRole('heading', { name: 'Recent Updates' })))
    await ui.findByText('Resume normal service.')
    assert.ok(ui.getByRole('button', { name: 'Active Decisions 37' }))
    assert.equal(ui.queryByRole('button', { name: /Awaiting review/ }), null)
    const search = () => ui.getByRole('searchbox', { name: 'Search by person label or physical description' })
    fireEvent.change(search(), { target: { value: 'old' } })
    await waitFor(() => assert.equal(typeof finishOldSearch, 'function'))
    fireEvent.change(search(), { target: { value: 'fresh' } })
    await ui.findByRole('button', { name: 'Fresh result' })
    await act(async () => finishOldSearch({ data: [{ label: 'Stale result' }], error: null }))
    assert.ok(searchRequests.find(r => r.query === 'old').signal.aborted)
    assert.equal(ui.queryByText('Stale result'), null)
    fireEvent.click(ui.getByRole('button', { name: 'View all results' }))
    assert.equal(search().value, 'fresh')
    await ui.findByRole('button', { name: 'Fresh result' })
    fireEvent.change(search(), { target: { value: 'offline' } })
    await ui.findByText('Could not load active bans.')
    assert.equal(ui.queryByText('No active service bans.'), null)
    fireEvent.click(ui.getByRole('button', { name: 'Clear' }))
    await ui.findByText('No active service bans.')

    fireEvent.click(ui.getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => assert.ok(ui.getByText('Read')))
    fireEvent.click(ui.getByRole('button', { name: 'Active Decisions' }))
    assert.ok(ui.getByRole('heading', { name: 'Recent Updates' }))
    assert.equal(ui.queryByRole('button', { name: 'Mark as read' }), null)
    manyUpdates = true
    fireEvent.click(within(ui.getByRole('navigation')).getByRole('button', { name: 'Home' }))
    const recent = within(ui.getByRole('region', { name: 'Recent Updates' }))
    await recent.findByLabelText('Unread in this pub: 20')
    await waitFor(() => assert.equal(recent.getAllByRole('listitem').length, 5))
    assert.equal(recent.getAllByText('Ban lifted').length, 5)
    const activeLink = recent.getByRole('link', { name: 'Active Decisions' })
    assert.equal(activeLink.parentElement.textContent, 'Past updates. Check Active Decisions for current restrictions.')
    await recent.findByText('Photo unavailable')
    assert.ok(recent.getAllByText('No photo').length)
    const photo = await recent.findByRole('button', { name: 'View incident photo for History guest 2' })
    const [dialog] = photo.parentElement.getElementsByTagName('dialog')
    dialog.showModal = () => { dialog.open = true }
    const photoUrl = photo.querySelector('img').src
    await act(async () => { assert.equal((await fetch(photoUrl)).ok, true) })
    fireEvent.click(photo)
    assert.ok(dialog.open)
    fireEvent.click(recent.getByRole('button', { name: 'View all updates' }))
    assert.ok(ui.getByRole('heading', { name: 'Updates', exact: true }))
    assert.equal(dialog.isConnected, false)
    await act(async () => { await assert.rejects(() => fetch(photoUrl)) })
    const history = within(ui.getByRole('region', { name: 'Lift history' }))
    await waitFor(() => assert.equal(history.getAllByRole('listitem').length, 20))
    fireEvent.click(history.getByRole('button', { name: 'Next' }))
    await history.findByText('History guest 20')
    assert.equal(history.getAllByRole('listitem').length, 1)
    fireEvent.click(history.getByRole('button', { name: 'Previous' }))
    await waitFor(() => assert.equal(history.getAllByRole('listitem').length, 20))
    const historySearch = history.getByRole('searchbox')
    fireEvent.change(historySearch, { target: { value: 'old update search' } })
    await waitFor(() => assert.equal(typeof finishOldUpdateSearch, 'function'))
    fireEvent.change(historySearch, { target: { value: 'dotted scarf' } })
    await history.findByText('History guest 20')
    await act(async () => finishOldUpdateSearch({ data: [{ ...historicalUpdate, person_label: 'Stale update' }], error: null }))
    assert.equal(oldUpdateSignal.aborted, true)
    assert.equal(history.queryByText('Stale update'), null)
    fireEvent.change(historySearch, { target: { value: 'nothing' } })
    await history.findByText('No matching updates.')
    fireEvent.change(historySearch, { target: { value: 'offline' } })
    await history.findByText('Could not load updates.')
    manyUpdates = false
    fireEvent.click(ui.getByRole('button',{name:'My Incidents'}))
    await waitFor(()=>assert.ok(ui.queryByText('PRIVATE_one')))
    fireEvent.click(ui.getByRole('button',{name:'Sign out'}))
    await waitFor(()=>assert.ok(ui.queryByText('Sign in to TeamBrief')))
    assert.equal(ui.queryByText('PRIVATE_one'),null)
    // Start an old-user request, then switch identity before it resolves.
    delayOld=true
    await act(async()=>{identity='one';listener('SIGNED_IN',{user:{id:'one',email:'one@example.test'}})})
    await waitFor(()=>assert.equal(typeof delayed,'function'))
    await act(async()=>{identity='two';listener('SIGNED_IN',{user:{id:'two',email:'two@example.test'}})})
    await waitFor(()=>assert.ok(ui.queryByRole('button',{name:'My Incidents'})))
    await waitFor(() => assert.ok(ui.getByRole('button', { name: 'Mark as read' })))
    fireEvent.click(ui.getByRole('button',{name:'My Incidents'}))
    await waitFor(()=>assert.ok(ui.queryByText('PRIVATE_two')))
    await act(async()=>delayed({data:[{id:'old',label:'LEAKED_OLD_USER'}],error:null}))
    assert.equal(ui.queryByText('LEAKED_OLD_USER'),null)
    assert.equal(ui.queryByText('PRIVATE_one'),null)
    assert.equal(ui.queryByLabelText('Demo profile'),null)
    await act(async () => { identity = 'status-manager'; listener('SIGNED_IN', { user: { id: identity, email: 'manager@example.test' } }) })
    await waitFor(() => assert.ok(ui.getByRole('heading', { name: 'Home' })))
    fireEvent.click(ui.getByRole('button', { name: 'My Incidents', exact: true }))
    const row = label => within(ui.getByText(label, { exact: true }).closest('li'))
    for (const [label, status] of [
      ['Awaiting guest', 'Awaiting review'], ['Overdue guest', 'Active ban'],
      ['Lifted guest', 'Ban lifted'], ['Reviewed guest', 'No ban required'],
    ]) {
      await waitFor(() => assert.ok(row(label).getByText(status)))
      assert.ok(row(label).getByText('Incident date'))
    }
    fireEvent.click(ui.getByRole('button', { name: 'Decision history', exact: true }))
    assert.equal(ui.queryByText('Awaiting guest'), null)
    assert.ok(row('Overdue guest').getByText('Active ban'))
    assert.ok(row('Overdue guest').getByText('Decision date'))
    assert.equal(row('Overdue guest').queryByText('Lifted date'), null)
    assert.ok(row('Lifted guest').getByText('Ban lifted'))
    assert.ok(row('Lifted guest').getByText('Lifted date'))
    assert.ok(row('Reviewed guest').getByText('No ban required'))

    await act(async () => { identity = 'missing-decision'; listener('SIGNED_IN', { user: { id: identity, email: 'missing@example.test' } }) })
    await ui.findByText('Incident decision data is unavailable.')
    fireEvent.click(ui.getByRole('button', { name: 'My Incidents', exact: true }))
    assert.equal(ui.queryByText('Awaiting review', { exact: true }), null)

    await act(async()=>{identity='no-membership';listener('SIGNED_IN',{user:{id:'no-membership',email:'none@example.test'}})})
    await waitFor(()=>assert.ok(ui.queryByText('Access not granted')))
    assert.equal(ui.queryByText('PRIVATE_two'),null)
    assert.equal(ui.queryByRole('button',{name:'My Incidents'}),null)
    assert.deepEqual(unassignedQueries, ['venue_memberships'])
  } finally {
    cleanup();await server.close();dom.window.close()
    for(const [key,descriptor] of previous) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key] }
  }
})
