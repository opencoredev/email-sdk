/**
 * A live, read-only view of a Map. `ReadonlyMap` is only a compile-time promise: handing out the
 * Map itself lets a caller cast it back and call `set` or `delete`. This view exposes the read
 * methods and nothing else, and still reflects later changes the owner makes to the Map.
 */
export class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #source: ReadonlyMap<K, V>;

  constructor(source: ReadonlyMap<K, V>) {
    this.#source = source;
  }

  get size(): number {
    return this.#source.size;
  }

  get(key: K): V | undefined {
    return this.#source.get(key);
  }

  has(key: K): boolean {
    return this.#source.has(key);
  }

  // `thisArg` is left out: an arrow function or bind covers it, and it is optional in ReadonlyMap.
  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [key, value] of this.#source) callback(value, key, this);
  }

  entries(): MapIterator<[K, V]> {
    return this.#source.entries();
  }

  keys(): MapIterator<K> {
    return this.#source.keys();
  }

  values(): MapIterator<V> {
    return this.#source.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#source[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ReadonlyMap";
  }
}
