import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('optional photo preview, validation, replacement, guarded retry and removal', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  const installation = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.keys(installation).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  for (const [key, value] of Object.entries(installation)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  const originalRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url) }

  try {
    const { ReportForm } = await server.ssrLoadModule('/src/App.tsx')
    const discarded = []
    const attempts = []
    let respond
    const ui = render(createElement(ReportForm, {
      onDiscardPhoto: file => discarded.push(file.name),
      onSave: (draft, file, progress) => {
        attempts.push({ draft, file })
        progress(file ? 'Uploading photo…' : 'Saving incident report…')
        return new Promise(resolve => { respond = resolve })
      },
    }))
    const fill = (label, value) => fireEvent.change(ui.getByLabelText(label), { target: { value } })
    fill('Short label for the person', 'Synthetic guest')
    fill('Incident date and time', '2020-01-01T12:15')
    fill('Incident type', 'other')
    fill('Identifying description', 'Imaginary green jacket')
    fill('Incident description', 'Fictional UI test.')
    const choose = (label, file) => fireEvent.change(ui.getByLabelText(label), { target: { files: [file] } })
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    choose('Choose photo', new File(['ftypheic'], 'fixture.heic', { type: 'image/heic' }))
    await waitFor(() => assert.match(ui.getByRole('alert').textContent, /HEIC/))
    assert.equal(ui.getByRole('button', { name: 'Submit report →' }).disabled, true)
    choose('Choose photo', new File([fakePng], 'first.png', { type: 'image/png' }))
    const firstPreview = await ui.findByAltText('Selected incident photo preview')
    const firstUrl = firstPreview.src
    choose('Replace photo', new File([fakePng], 'second.png', { type: 'image/png' }))
    await waitFor(() => assert.notEqual(ui.getByAltText('Selected incident photo preview').src, firstUrl))
    assert.deepEqual(discarded, ['first.png'])
    assert.ok(revoked.includes(firstUrl))
    fireEvent.load(ui.getByAltText('Selected incident photo preview'))

    const submit = ui.getByRole('button', { name: 'Submit report →' })
    fireEvent.click(submit)
    fireEvent.submit(submit.form)
    assert.equal(attempts.length, 1)
    assert.ok(ui.getByText('Uploading photo…'))
    assert.equal(attempts[0].file.name, 'second.png')
    await act(async () => respond('Photo upload failed. Please retry.'))
    assert.ok(ui.getByRole('alert'))
    assert.equal(ui.getByLabelText('Incident description').value, 'Fictional UI test.')
    assert.ok(ui.getByAltText('Selected incident photo preview'))
    fireEvent.click(ui.getByRole('button', { name: 'Remove photo' }))
    assert.equal(ui.queryByAltText('Selected incident photo preview'), null)
    fireEvent.click(ui.getByRole('button', { name: 'Submit report →' }))
    assert.equal(attempts[1].file, null)
    assert.deepEqual(attempts[0].draft, attempts[1].draft)
    await act(async () => respond(null))
  } finally {
    cleanup()
    URL.revokeObjectURL = originalRevoke
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
