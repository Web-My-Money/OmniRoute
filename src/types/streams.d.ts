// The Web Streams spec defines an optional `cancel()` callback on Transformer
// (fires when the writable side aborts); the TS DOM lib omits it. This global
// augmentation restores it so TransformStream constructors can clear timers and
// flush state on client disconnect without excess-property errors.
// Type-parameter defaults must match lib.dom.d.ts exactly for interface merging.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- names/arity fixed by declaration merging
interface Transformer<I = any, O = any> {
  cancel?(reason?: any): void;
}
