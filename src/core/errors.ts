export class QualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityError";
  }
}

export function fail(message: string): never {
  throw new QualityError(message);
}
