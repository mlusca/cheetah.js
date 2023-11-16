import { getMetadataStorage } from 'class-validator';

/**
 * Verifica se a classe possui implementação do class-validator ou class-transformer.
 *
 * @param token
 */
export function isClassValidator(token: Function) {
  const validationMetadata = getMetadataStorage()

  return validationMetadata.getTargetValidationMetadatas(token, '', false, false, []).length > 0
}