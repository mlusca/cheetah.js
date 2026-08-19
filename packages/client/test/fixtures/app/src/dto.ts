export interface User {
    id: string;
    name: string;
    email: string;
}

export class CreateUserDto {
    name: string;
    email: string;
    age?: number;
}

export class UpdateUserDto {
    name?: string;
    email?: string;
}
