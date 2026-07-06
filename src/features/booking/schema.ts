import { z } from 'zod'

export const bookingBody = z.object({
  equipmentId: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  purpose: z.string().max(500).default(''),
  recurring: z
    .object({
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      startMinutes: z.number().int().min(0).max(1439),
      durationMinutes: z.number().int().min(15).max(1440),
      firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
})
