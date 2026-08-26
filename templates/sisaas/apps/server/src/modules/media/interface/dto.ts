import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateUploadSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export class CreateUploadDto extends createZodDto(CreateUploadSchema) {}
