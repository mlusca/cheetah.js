import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database'
import { BaseEntity, Entity, PrimaryKey, Property } from '../../src'

@Entity({ tableName: 'ilike_user' })
class IlikeUser extends BaseEntity {
  @PrimaryKey()
  id: number

  @Property()
  name: string

  @Property()
  email: string
}

describe('$ilike / $notIlike operators', () => {
  const DDL = `
    CREATE TABLE "ilike_user" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL
    );
  `

  beforeEach(async () => {
    await startDatabase()
    await execute(DDL)
    ;(mockLogger as jest.Mock).mockClear()
  })

  afterEach(async () => {
    await purgeDatabase()
    await app?.disconnect()
    ;(mockLogger as jest.Mock).mockClear()
  })

  test('Given users with mixed case names When filtering by $ilike Then it matches regardless of case', async () => {
    await IlikeUser.create({ id: 1, name: 'João Silva', email: 'joao@example.com' })
    await IlikeUser.create({ id: 2, name: 'Maria Souza', email: 'maria@example.com' })

    ;(mockLogger as jest.Mock).mockClear()

    const result = await IlikeUser.find({
      name: { $ilike: 'joão%' }
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)

    const logged = (mockLogger as jest.Mock).mock.calls[0][0]
    if (app?.driverInstance?.dbType === 'mysql') {
      expect(logged).toContain('LOWER(')
      expect(logged).toContain("LIKE LOWER('jo")
    } else {
      expect(logged).toContain('ILIKE')
    }
  })

  test('Given users with mixed case emails When filtering by $notIlike Then it excludes matches regardless of case', async () => {
    await IlikeUser.create({ id: 3, name: 'Ana Lima', email: 'ANA@EXAMPLE.COM' })
    await IlikeUser.create({ id: 4, name: 'Bruno Melo', email: 'bruno@other.com' })

    ;(mockLogger as jest.Mock).mockClear()

    const result = await IlikeUser.find({
      email: { $notIlike: '%@example.com' }
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(4)

    const logged = (mockLogger as jest.Mock).mock.calls[0][0]
    if (app?.driverInstance?.dbType === 'mysql') {
      expect(logged).toContain('LOWER(')
      expect(logged).toContain('NOT LIKE LOWER(')
    } else {
      expect(logged).toContain('NOT ILIKE')
    }
  })
})
