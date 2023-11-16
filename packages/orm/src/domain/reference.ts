export class Reference<T> {
  constructor(private entity: T) {
    console.log('Reference constructor')
  }
}