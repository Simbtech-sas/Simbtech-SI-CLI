import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * The integration test that matters: does tenant isolation hold through the // si:when multi-tenant
 * whole stack — guard, service, RLS — rather than only in SQL. // si:when multi-tenant
 * The integration test that matters: does the guard actually stand between an // si:when single-tenant
 * anonymous caller and these routes? Nothing behind it will. // si:when single-tenant
 *
 * Needs the docker stack and a migrated database:
 *   pnpm infra:up && pnpm db:migrate && pnpm test:e2e
 */
describe('widgets (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/widgets').expect(401);
  });

  it('refuses a token this service did not issue', async () => {
    // A well-formed JWT signed with the wrong key. If this ever returns 200,
    // the algorithm pin or the issuer check has been lost.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJhdHRhY2tlciIsInRlbmFudElkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIn0.' +
      'bm90LWEtcmVhbC1zaWduYXR1cmU';
    await request(app.getHttpServer())
      .get('/widgets')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('reports healthy', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  // si:when-begin multi-tenant
  // Add the authenticated cases once you have a seeded tenant:
  //   register two tenants, list widgets as each, assert neither sees the other's.
  // That is the assertion RLS exists for, and scripts/verify-rls.sh proves the
  // same property at the database level.
  // si:when-end
  // si:when-begin single-tenant
  // Add the authenticated cases next, and make the FIRST one the unauthenticated
  // case: GET /widgets with no token must be 401. In this build the guard is the
  // only thing enforcing that, so it is the assertion worth having.
  // si:when-end
});
