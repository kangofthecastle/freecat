// src/main/flashcards/anki-proto.ts
import protobuf from 'protobufjs'

// Minimal subset of Anki's schema-18 protobufs — only the fields we read. Field numbers
// match ankitects/anki: notetypes.proto (Notetype.Config kind=1, css=3),
// (Template.Config q_format=1, a_format=2) and import_export.proto (MediaEntries).
// Unknown fields on the wire are ignored by protobuf, so this stays tiny and forward-compatible.
const PROTO = `
syntax = "proto3";
package fc;
message NotetypeConfig { uint32 kind = 1; string css = 3; }
message TemplateConfig { string q_format = 1; string a_format = 2; }
message MediaEntries {
  message MediaEntry { string name = 1; }
  repeated MediaEntry entries = 1;
}
`

const root = protobuf.parse(PROTO, { keepCase: true }).root
export const NotetypeConfig = root.lookupType('fc.NotetypeConfig')
export const TemplateConfig = root.lookupType('fc.TemplateConfig')
export const MediaEntries = root.lookupType('fc.MediaEntries')
