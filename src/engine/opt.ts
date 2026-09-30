// Optional id / date / month fields: an empty string means "not set", exactly like undefined.
// A backup restores an empty optional cell as a missing field, while a form (a select with an empty
// option, a cleared date field) may hand over ''. Wherever the engine branches on whether such a
// field is set, it reads the field through `opt`, so both spellings give the same numbers.

/** The value, or undefined when it is not set ('' counts as not set). */
export function opt<T extends string>(v: T | undefined): T | undefined {
  return v === '' ? undefined : v;
}
