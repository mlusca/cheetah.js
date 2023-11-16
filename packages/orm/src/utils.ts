export function getDefaultLength(type: string): number {
  if (type === 'String') {
    return 255;
  }

  if (type === 'Number') {
    return 11;
  }

  if (type === 'Boolean') {
    return 1;
  }

  if (type === 'Date') {
    return 6;
  }
  return 255;
}