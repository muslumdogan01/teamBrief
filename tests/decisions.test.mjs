import test from 'node:test'
import assert from 'node:assert/strict'
import { activeBans, addDecision, currentStorageKey, liftBan, loadStore, parseStore, pendingReports, reviewDue, validateDecision, writeStore } from '../src/decisions.ts'
import { storageKey } from '../src/reports.ts'

const now = Date.parse('2026-11-11T12:00:00Z')
const report = { id: 'old-report', label: 'Mavi ceketli misafir', occurredAt: '2020-01-01T12:00:00Z', incidentType: 'Rahatsızlık çıkarma', severity: 'high', appearance: 'Mavi ceket, gözlük', description: 'Asıl olay açıklaması.', employee: 'Müslüm', status: 'İnceleme bekliyor', createdAt: '2020-01-01T13:00:00Z' }
const banDraft = { kind: 'ban', explanation: 'Tekrarlanma riski', severity: 'low', instruction: 'Servis yapmayın; yöneticiye haber verin.', reviewAt: '2026-11-12T12:00:00Z' }
function memoryStorage(entries = []) {
  const data = new Map(entries)
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
function fixture() { return { version: 2, reports: [structuredClone(report)], decisions: [] } }

test('v1 kayıtları kayıpsız taşınır, kaynak yedek kalır ve geçiş tekrar kararları sıfırlamaz', () => {
  const legacy = JSON.stringify([report])
  const storage = memoryStorage([[storageKey, legacy]])
  const migrated = loadStore(storage)
  assert.deepEqual(migrated.reports, [report])
  assert.equal(storage.getItem(storageKey), legacy)
  const reviewed = addDecision(migrated, 'manager', report.id, banDraft, now)
  writeStore(storage, reviewed)
  assert.deepEqual(loadStore(storage), reviewed)
  assert.equal(loadStore(storage).decisions.length, 1)
  assert.equal(storage.getItem(storageKey), legacy)
})
test('bozuk eski veya yeni kayıtlar silinmez, üzerlerine yazılmaz', () => {
  for (const key of [storageKey, currentStorageKey]) {
    const storage = memoryStorage([[key, 'bozuk']])
    assert.throws(() => loadStore(storage))
    assert.equal(storage.getItem(key), 'bozuk')
    if (key === storageKey) assert.equal(storage.getItem(currentStorageKey), null)
  }
  const storage = memoryStorage([[storageKey, JSON.stringify([report])]])
  storage.setItem = () => { throw new Error('Depolama dolu') }
  assert.throws(() => loadStore(storage))
  assert.equal(storage.getItem(storageKey), JSON.stringify([report]))
})
test('bildirim → yönetici kararı → aktif liste → kaldırma; asıl metin ve geçmiş korunur', () => {
  const original = fixture()
  assert.equal(pendingReports(original).length, 1)
  const reviewed = addDecision(original, 'manager', report.id, banDraft, now)
  assert.equal(pendingReports(reviewed).length, 0)
  assert.equal(activeBans(reviewed).length, 1)
  assert.deepEqual(reviewed.reports, original.reports)
  assert.equal(original.decisions.length, 0)
  const ban = reviewed.decisions[0]
  assert.equal(ban.manager, 'Alex')
  assert.equal(ban.decidedAt, new Date(now).toISOString())
  assert.equal(ban.severity, 'low')
  assert.equal(reviewDue(ban, now), false)
  const later = Date.parse('2026-11-13T12:00:00Z')
  assert.equal(reviewDue(ban, later), true)
  assert.equal(activeBans(reviewed).length, 1, 'tarihi geçen yasak aktif kalır')
  const lifted = liftBan(reviewed, 'manager', ban.id, '  Yeniden değerlendirildi.  ', later)
  assert.equal(activeBans(lifted).length, 0)
  assert.equal(pendingReports(lifted).length, 0)
  assert.equal(lifted.decisions.length, 1)
  assert.equal(lifted.decisions[0].lifted.reason, 'Yeniden değerlendirildi.')
  assert.equal(lifted.decisions[0].lifted.manager, 'Alex')
  assert.equal(lifted.decisions[0].lifted.at, new Date(later).toISOString())
  assert.equal(reviewDue(lifted.decisions[0], later), false)
  assert.deepEqual(parseStore(JSON.stringify(lifted)), lifted)
  assert.deepEqual(lifted.reports, [report])
})
test('yasak gerekmiyor kararı açıklama ister, bekleyeni azaltır ve aktif yasak oluşturmaz', () => {
  assert.throws(() => addDecision(fixture(), 'manager', report.id, { ...banDraft, kind: 'no-ban', explanation: '   ' }, now))
  const reviewed = addDecision(fixture(), 'manager', report.id, { ...banDraft, kind: 'no-ban', instruction: '', reviewAt: '', explanation: 'Uyarı sonrası durum düzeldi.' }, now)
  assert.equal(pendingReports(reviewed).length, 0)
  assert.equal(activeBans(reviewed).length, 0)
  assert.equal(reviewed.decisions[0].kind, 'no-ban')
  assert.deepEqual(parseStore(JSON.stringify(reviewed)), reviewed)
})
test('boşluklar, eksik talimat ve geçmiş/şimdiki gözden geçirme tarihleri reddedilir', () => {
  for (const field of ['explanation', 'instruction']) assert.ok(validateDecision({ ...banDraft, [field]: '  ' }, now)[field])
  for (const reviewAt of ['', 'geçersiz', new Date(now).toISOString(), '2020-01-01T12:00:00Z']) assert.ok(validateDecision({ ...banDraft, reviewAt }, now).reviewAt)
  assert.deepEqual(validateDecision(banDraft, now), {})
})
test('çalışan karar veremez/kaldıramaz; ikinci karar ve ikinci kaldırma engellenir', () => {
  assert.throws(() => addDecision(fixture(), 'employee', report.id, banDraft, now))
  const reviewed = addDecision(fixture(), 'manager', report.id, banDraft, now)
  const id = reviewed.decisions[0].id
  assert.throws(() => addDecision(reviewed, 'manager', report.id, banDraft, now))
  assert.throws(() => addDecision(fixture(), 'manager', 'olmayan', banDraft, now))
  assert.throws(() => liftBan(reviewed, 'employee', id, 'Gerekçe', now))
  assert.throws(() => liftBan(reviewed, 'manager', id, '   ', now))
  const lifted = liftBan(reviewed, 'manager', id, 'Gerekçe', now)
  assert.throws(() => liftBan(lifted, 'manager', id, 'Yeniden', now))
})
test('kopuk ve yinelenen karar ilişkileri reddedilir', () => {
  const reviewed = addDecision(fixture(), 'manager', report.id, banDraft, now)
  assert.throws(() => parseStore(JSON.stringify({ ...reviewed, reports: [] })))
  assert.throws(() => parseStore(JSON.stringify({ ...reviewed, decisions: [...reviewed.decisions, ...reviewed.decisions] })))
})
