-- partial unique index; not representable in schema.prisma
CREATE UNIQUE INDEX invitation_pending_email_unique
  ON "Invitation" (email)
  WHERE (status = 'PENDING');
