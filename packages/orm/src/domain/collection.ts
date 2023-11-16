export class ArrayCollection<T extends object, O extends object> {
  getItems(): T[] {
    return [];
  }
}
export class Collection<T extends object, O extends object = object> extends ArrayCollection<T, O> {
  constructor(owner: O, items?: T[], initialized = true) {
    super();
  }
}