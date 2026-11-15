import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { createServer } from 'vite'

test('sign-in errors, sign-out, account switching and delayed old data are handled by the UI', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost'})
  const previous = new Map()
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
  }
  const {render,fireEvent,waitFor,cleanup,act} = await import('@testing-library/react')
  const server = await createServer({server:{middlewareMode:true,watch:null,ws:false},appType:'custom'})
  let listener
  let identity = null
  let delayed
  let delayOld = false
  const client = {
    auth: {
      onAuthStateChange(fn) { listener=fn; return {data:{subscription:{unsubscribe(){}}}} },
      async getSession() { return {data:{session:null},error:null} },
      async signInWithPassword({password}) { if(password==='wrong') return {error:{message:'Invalid login credentials'},data:null}; identity='one'; listener('SIGNED_IN',{user:{id:'one',email:'one@example.test'}}); return {data:{},error:null} },
      async signOut() { identity=null; listener('SIGNED_OUT',null); return {error:null} },
    },
    from(table) {
      const owner=identity
      const query={select(){return query},eq(){return query},order(){return query},single(){return Promise.resolve({data:{display_name:owner},error:null})},then(resolve,reject){
        if(table==='incident_reports' && owner==='one' && delayOld) return new Promise(r=>{delayed=r}).then(resolve,reject)
        const data = table==='venue_memberships' ? (owner==='no-membership' ? [] : [{venue_id:'pub',role:'staff',venues:{name:'Test Pub'}}]) : table==='incident_reports' ? [{id:owner,label:`PRIVATE_${owner}`,reported_by:owner,occurred_at:'2020-01-01',created_at:'2020-01-01',incident_type:'other',severity:'low',appearance:'Hat',description:`Description ${owner}`}] : []
        return Promise.resolve({data,error:null}).then(resolve,reject)
      }}; return query
    },
    async rpc(){return {data:[],error:null}},
  }
  try {
    const {AuthApp} = await server.ssrLoadModule('/src/ConnectedApp.tsx')
    const ui=render(createElement(AuthApp,{client}))
    await waitFor(()=>assert.ok(ui.queryByText('Sign in to TeamBrief')))
    fireEvent.change(ui.getByLabelText('Email'),{target:{value:'one@example.test'}})
    fireEvent.change(ui.getByLabelText('Password'),{target:{value:'wrong'}})
    fireEvent.click(ui.getByRole('button',{name:'Sign in'}))
    await waitFor(()=>assert.ok(ui.queryByRole('alert')?.textContent.includes('Invalid login credentials')))
    assert.equal(ui.queryByText('Saved successfully.'),null)
    fireEvent.change(ui.getByLabelText('Password'),{target:{value:'correct'}})
    fireEvent.click(ui.getByRole('button',{name:'Sign in'}))
    await waitFor(()=>assert.ok(ui.queryByRole('button',{name:'My Incidents'})))
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
    fireEvent.click(ui.getByRole('button',{name:'My Incidents'}))
    await waitFor(()=>assert.ok(ui.queryByText('PRIVATE_two')))
    await act(async()=>delayed({data:[{id:'old',label:'LEAKED_OLD_USER'}],error:null}))
    assert.equal(ui.queryByText('LEAKED_OLD_USER'),null)
    assert.equal(ui.queryByText('PRIVATE_one'),null)
    assert.equal(ui.queryByLabelText('Demo profile'),null)
    await act(async()=>{identity='no-membership';listener('SIGNED_IN',{user:{id:'no-membership',email:'none@example.test'}})})
    await waitFor(()=>assert.ok(ui.queryByText('Access not granted')))
    assert.equal(ui.queryByText('PRIVATE_two'),null)
    assert.equal(ui.queryByRole('button',{name:'My Incidents'}),null)
  } finally {
    cleanup();await server.close();dom.window.close()
    for(const [key,descriptor] of previous) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key] }
  }
})
