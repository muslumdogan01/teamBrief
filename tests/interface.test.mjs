import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { currentStorageKey, legacyStorageKey } from '../src/decisions.ts'

test('rendered employee home uses English labels and migrates legacy records', async () => {
  const text = 'Kullanıcının yazdığı açıklama değişmez.'
  const legacy = JSON.stringify({ version: 2, reports: [{ id: '1', label: text, occurredAt: '2020-01-01T12:00:00Z', incidentType: 'Sarhoşluk', severity: 'high', appearance: 'Mavi ceket', description: text, employee: 'Müslüm', status: 'İnceleme bekliyor', createdAt: '2020-01-01T13:00:00Z' }], decisions: [] })
  const entries = new Map([[legacyStorageKey, legacy]])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } })
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(App))
    for (const label of ['Home', 'Report Incident', 'My Reports', 'Active Decisions', 'Total reports', 'Awaiting review', 'Recent reports', 'Intoxication', 'High severity', 'Müslüm', 'Employee', 'Alex', 'Manager', 'Demo profile']) assert.ok(html.includes(label), label)
    assert.ok(html.includes(text), 'user text remains unchanged')
    for (const old of ['Ana Sayfa', 'Bildirimlerim', 'İnceleme bekliyor', 'Sarhoşluk']) assert.ok(!html.includes(old), old)
    assert.ok(!html.includes('>Management</button>'), 'management remains hidden from employees')
    assert.equal(entries.get(legacyStorageKey), legacy)
    assert.equal(JSON.parse(entries.get(currentStorageKey)).reports[0].incidentType, 'intoxication')
    const document = await readFile(new URL('../index.html', import.meta.url), 'utf8')
    assert.match(document, /<html lang="en">/)
  } finally {
    await server.close()
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
