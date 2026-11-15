import test from 'node:test'
import assert from 'node:assert/strict'
import { incidentLabels, incidentTypes, severityLabels, roleLabels, statusLabels, parseReports, validateDraft, formatDate } from '../src/reports.ts'
import { validateDecision, addDecision, liftBan } from '../src/decisions.ts'

const report = { id: '1', label: '  Mavi ceket  ', occurredAt: '2020-01-01T12:00', incidentType: 'other', severity: 'medium', appearance: '  Gözlüklü  ', description: '  Türkçe olay açıklaması.\n  ', employee: 'Müslüm', status: 'pending_review', createdAt: '2020-01-01T13:00Z' }
test('English labels are separate from fixed incident, severity, role and status codes', () => {
  assert.deepEqual(incidentTypes, ['aggressive_behaviour', 'causing_disturbance', 'intoxication', 'rule_violation', 'other'])
  assert.deepEqual(Object.values(incidentLabels), ['Aggressive behaviour', 'Causing a disturbance', 'Intoxication', 'Breach of venue rules', 'Other'])
  assert.deepEqual(severityLabels, { low: 'Low', medium: 'Medium', high: 'High' })
  assert.deepEqual(roleLabels, { employee: 'Employee', manager: 'Manager' })
  assert.deepEqual(statusLabels, { pending_review: 'Awaiting review' })
})
test('all Turkish incident and severity values migrate without changing user text', () => {
  const legacyTypes = ['Saldırgan davranış', 'Rahatsızlık çıkarma', 'Sarhoşluk', 'Mekân kurallarını ihlal', 'Diğer']
  for (const [index, incidentType] of legacyTypes.entries()) {
    const [converted] = parseReports(JSON.stringify([{ ...report, incidentType, status: 'İnceleme bekliyor' }]))
    assert.deepEqual(converted, { ...report, incidentType: incidentTypes[index] })
    assert.deepEqual(parseReports(JSON.stringify([converted])), [converted])
  }
  for (const [severity, code] of [['Düşük', 'low'], ['Orta', 'medium'], ['Yüksek', 'high']]) {
    assert.equal(parseReports(JSON.stringify([{ ...report, severity }]))[0].severity, code)
  }
  assert.throws(() => parseReports(JSON.stringify([{ ...report, incidentType: 'unknown' }])))
})
test('report and decision validation errors are in English', () => {
  assert.deepEqual(validateDraft({ ...report, label: ' ', appearance: ' ', description: ' ', occurredAt: '', incidentType: '', severity: '' }), {
    label: 'This field is required.', appearance: 'This field is required.', description: 'This field is required.', occurredAt: 'Choose a valid date and time.', incidentType: 'Select an incident type.', severity: 'Select a severity level.',
  })
  assert.equal(validateDraft({ ...report, occurredAt: '2999-01-01T12:00' }).occurredAt, 'The incident date and time cannot be in the future.')
  assert.deepEqual(validateDecision({ kind: 'ban', explanation: ' ', instruction: ' ', reviewAt: '', severity: '' }), {
    explanation: 'Please give a reason for the decision.', severity: 'Select the final severity.', instruction: 'Provide service instructions for staff.', reviewAt: 'Choose a future review date and time.',
  })
  const store = { version: 3, reports: [report], decisions: [] }
  assert.throws(() => addDecision(store, 'employee', '1', {}), { message: 'This action is only available in the manager demo profile.' })
  assert.throws(() => liftBan(store, 'manager', '1', ' '), { message: 'Please give a reason for lifting the ban.' })
})
test('dates and times use en-IE formatting', () => {
  const date = '2026-11-13T16:05:00Z'
  assert.equal(formatDate(date), new Intl.DateTimeFormat('en-IE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date)))
  assert.match(formatDate(date), /November/)
})
