import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{1,30}$/, 'lowercase letters, digits and dashes');

export class RegisterDto extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().trim().min(1).optional(),
    tenantName: z.string().trim().min(1),
    slug,
  }),
) {}

export class LoginDto extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
) {}

export class UpdateProfileDto extends createZodDto(
  z.object({ name: z.string().trim().min(1).optional() }),
) {}

export class ChangePasswordDto extends createZodDto(
  z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
) {}
