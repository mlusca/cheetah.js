export function isPrimitiveType(type: any): boolean {
    return (
        type === String ||
        type === Number ||
        type === Boolean ||
        type === Symbol ||
        type === undefined ||
        type === null
    );
}