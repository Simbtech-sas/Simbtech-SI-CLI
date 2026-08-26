import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { TenantTx } from '../../../database/database.service';
import { widgets } from '../../../database/schema';
import type { NewWidget, Widget, WidgetPatch } from '../domain/widget';

/**
 * Pure data access. Every method takes the caller's transaction rather than
 * opening its own, so a service can write a row and its outbox event in ONE
 * unit of work — see WidgetsService.
 *
 * That transaction always carries the tenant GUC (WidgetsService uses
 * runInTenantContext), so RLS confines these queries to the caller's tenant. No
 * query here needs — or is trusted to add — a manual `where tenant_id = ...`;
 * the database enforces it.
 */
@Injectable()
export class WidgetsRepository {
  list(tx: TenantTx): Promise<Widget[]> {
    return tx.select().from(widgets).orderBy(desc(widgets.createdAt));
  }

  async get(tx: TenantTx, id: string): Promise<Widget | undefined> {
    const [row] = await tx.select().from(widgets).where(eq(widgets.id, id)).limit(1);
    return row;
  }

  async create(tx: TenantTx, tenantId: string, input: NewWidget): Promise<Widget> {
    const [row] = await tx
      .insert(widgets)
      .values({ tenantId, ...input })
      .returning();
    return row!;
  }

  async update(tx: TenantTx, id: string, patch: WidgetPatch): Promise<Widget | undefined> {
    const [row] = await tx
      .update(widgets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(widgets.id, id))
      .returning();
    return row;
  }

  async remove(tx: TenantTx, id: string): Promise<boolean> {
    const rows = await tx.delete(widgets).where(eq(widgets.id, id)).returning({ id: widgets.id });
    return rows.length > 0;
  }
}
