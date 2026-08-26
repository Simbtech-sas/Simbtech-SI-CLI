import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class CreateWidgetDto extends createZodDto(
  z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    quantity: z.coerce.number().int().nonnegative().default(0),
  }),
) {}

export class UpdateWidgetDto extends createZodDto(
  z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    quantity: z.coerce.number().int().nonnegative().optional(),
  }),
) {}
