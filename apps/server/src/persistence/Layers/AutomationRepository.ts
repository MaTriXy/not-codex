import {
  AutomationDefinition,
  AutomationRun,
  AutomationRunEvent,
  AutomationRunId,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AutomationRepository,
  ClaimAutomationRunInput,
  ListAutomationDefinitionsInput,
  ListAutomationRunsInput,
  ListDueAutomationDefinitionsInput,
  RenewAutomationRunLeaseInput,
  SoftDeleteAutomationDefinitionInput,
  type AutomationRepositoryShape,
} from "../Services/AutomationRepository.ts";

const DefinitionJsonRow = Schema.Struct({
  value: Schema.fromJsonString(AutomationDefinition),
});
const RunJsonRow = Schema.Struct({ value: Schema.fromJsonString(AutomationRun) });
const RunEventJsonRow = Schema.Struct({ value: Schema.fromJsonString(AutomationRunEvent) });
const RunIdInput = Schema.Struct({ runId: AutomationRunId });

function definitionNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

const makeAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertDefinitionQuery = SqlSchema.void({
    Request: AutomationDefinition,
    execute: (definition) => sql`
      INSERT INTO automation_definitions (
        automation_id, project_id, name_key, definition_json, enabled,
        next_run_at, created_at, updated_at, deleted_at
      ) VALUES (
        ${definition.id}, ${definition.projectId}, ${definitionNameKey(definition.name)},
        ${JSON.stringify(definition)}, ${definition.enabled ? 1 : 0}, ${definition.nextRunAt},
        ${definition.createdAt}, ${definition.updatedAt}, ${definition.deletedAt}
      )
      ON CONFLICT (automation_id) DO UPDATE SET
        project_id = excluded.project_id,
        name_key = excluded.name_key,
        definition_json = excluded.definition_json,
        enabled = excluded.enabled,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `,
  });

  const getDefinitionQuery = SqlSchema.findOneOption({
    Request: Schema.Struct({ automationId: AutomationDefinition.fields.id }),
    Result: DefinitionJsonRow,
    execute: ({ automationId }) => sql`
      SELECT definition_json AS value
      FROM automation_definitions
      WHERE automation_id = ${automationId} AND deleted_at IS NULL
    `,
  });

  const listDefinitionsQuery = SqlSchema.findAll({
    Request: ListAutomationDefinitionsInput,
    Result: DefinitionJsonRow,
    execute: ({ projectId, includeDisabled }) => sql`
      SELECT definition_json AS value
      FROM automation_definitions
      WHERE deleted_at IS NULL
        AND (${projectId ?? null} IS NULL OR project_id = ${projectId ?? null})
        AND (${includeDisabled === true ? 1 : 0} = 1 OR enabled = 1)
      ORDER BY created_at ASC, automation_id ASC
    `,
  });

  const listDueDefinitionsQuery = SqlSchema.findAll({
    Request: ListDueAutomationDefinitionsInput,
    Result: DefinitionJsonRow,
    execute: ({ now, limit }) => sql`
      SELECT definition_json AS value
      FROM automation_definitions
      WHERE deleted_at IS NULL AND enabled = 1
        AND next_run_at IS NOT NULL AND next_run_at <= ${now}
      ORDER BY next_run_at ASC, automation_id ASC
      LIMIT ${limit}
    `,
  });

  const softDeleteDefinitionQuery = SqlSchema.void({
    Request: SoftDeleteAutomationDefinitionInput,
    execute: ({ automationId, deletedAt }) => sql`
      UPDATE automation_definitions
      SET enabled = 0,
          deleted_at = ${deletedAt},
          updated_at = ${deletedAt},
          definition_json = json_set(
            definition_json,
            '$.enabled', json('false'),
            '$.deletedAt', ${deletedAt},
            '$.updatedAt', ${deletedAt}
          )
      WHERE automation_id = ${automationId} AND deleted_at IS NULL
    `,
  });

  const insertRunQuery = SqlSchema.findOneOption({
    Request: AutomationRun,
    Result: RunJsonRow,
    execute: (run) => sql`
      INSERT INTO automation_runs (
        run_id, automation_id, run_json, trigger_kind, status, scheduled_for,
        attempt, thread_id, lease_owner, lease_expires_at, created_at, updated_at, finished_at
      ) VALUES (
        ${run.id}, ${run.automationId}, ${JSON.stringify(run)}, ${run.trigger}, ${run.status},
        ${run.scheduledFor}, ${run.attempt}, ${run.threadId}, ${run.leaseOwner},
        ${run.leaseExpiresAt}, ${run.createdAt}, ${run.updatedAt}, ${run.finishedAt}
      )
      ON CONFLICT DO NOTHING
      RETURNING run_json AS value
    `,
  });

  const upsertRunQuery = SqlSchema.void({
    Request: AutomationRun,
    execute: (run) => sql`
      INSERT INTO automation_runs (
        run_id, automation_id, run_json, trigger_kind, status, scheduled_for,
        attempt, thread_id, lease_owner, lease_expires_at, created_at, updated_at, finished_at
      ) VALUES (
        ${run.id}, ${run.automationId}, ${JSON.stringify(run)}, ${run.trigger}, ${run.status},
        ${run.scheduledFor}, ${run.attempt}, ${run.threadId}, ${run.leaseOwner},
        ${run.leaseExpiresAt}, ${run.createdAt}, ${run.updatedAt}, ${run.finishedAt}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        run_json = excluded.run_json,
        trigger_kind = excluded.trigger_kind,
        status = excluded.status,
        scheduled_for = excluded.scheduled_for,
        attempt = excluded.attempt,
        thread_id = excluded.thread_id,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at
    `,
  });

  const getRunQuery = SqlSchema.findOneOption({
    Request: RunIdInput,
    Result: RunJsonRow,
    execute: ({ runId }) => sql`
      SELECT run_json AS value FROM automation_runs WHERE run_id = ${runId}
    `,
  });

  const listRunsQuery = SqlSchema.findAll({
    Request: ListAutomationRunsInput,
    Result: RunJsonRow,
    execute: ({ automationId, status, limit }) => sql`
      SELECT run_json AS value
      FROM automation_runs
      WHERE (${automationId ?? null} IS NULL OR automation_id = ${automationId ?? null})
        AND (${status ?? null} IS NULL OR status = ${status ?? null})
      ORDER BY scheduled_for DESC, run_id DESC
      LIMIT ${limit}
    `,
  });

  const claimNextRunQuery = SqlSchema.findOneOption({
    Request: ClaimAutomationRunInput,
    Result: RunJsonRow,
    execute: ({ owner, now, leaseExpiresAt }) => sql`
      UPDATE automation_runs
      SET status = 'preparing',
          lease_owner = ${owner},
          lease_expires_at = ${leaseExpiresAt},
          updated_at = ${now},
          run_json = json_set(
            run_json,
            '$.status', 'preparing',
            '$.leaseOwner', ${owner},
            '$.leaseExpiresAt', ${leaseExpiresAt},
            '$.updatedAt', ${now}
          )
      WHERE run_id = (
        SELECT run_id FROM automation_runs
        WHERE status IN (
          'queued', 'retry-wait', 'preparing', 'running',
          'waiting-for-approval', 'waiting-for-input'
        )
          AND scheduled_for <= ${now}
          AND (
            status IN ('queued', 'retry-wait')
            OR lease_expires_at IS NULL
            OR lease_expires_at <= ${now}
          )
        ORDER BY scheduled_for ASC, run_id ASC
        LIMIT 1
      )
      RETURNING run_json AS value
    `,
  });

  const renewRunLeaseQuery = SqlSchema.findOneOption({
    Request: RenewAutomationRunLeaseInput,
    Result: RunJsonRow,
    execute: ({ runId, owner, now, leaseExpiresAt }) => sql`
      UPDATE automation_runs
      SET lease_expires_at = ${leaseExpiresAt},
          updated_at = ${now},
          run_json = json_set(
            run_json,
            '$.leaseExpiresAt', ${leaseExpiresAt},
            '$.updatedAt', ${now}
          )
      WHERE run_id = ${runId} AND lease_owner = ${owner}
        AND status IN (
          'preparing', 'running', 'waiting-for-approval',
          'waiting-for-input', 'retry-wait'
        )
      RETURNING run_json AS value
    `,
  });

  const appendRunEventQuery = SqlSchema.void({
    Request: AutomationRunEvent,
    execute: (event) => sql`
      INSERT INTO automation_run_events (event_id, run_id, event_json, event_kind, created_at)
      VALUES (${event.id}, ${event.runId}, ${JSON.stringify(event)}, ${event.kind}, ${event.createdAt})
      ON CONFLICT (event_id) DO NOTHING
    `,
  });

  const listRunEventsQuery = SqlSchema.findAll({
    Request: RunIdInput,
    Result: RunEventJsonRow,
    execute: ({ runId }) => sql`
      SELECT event_json AS value
      FROM automation_run_events
      WHERE run_id = ${runId}
      ORDER BY created_at ASC, event_id ASC
    `,
  });

  const sqlError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));

  return AutomationRepository.of({
    upsertDefinition: (definition) =>
      upsertDefinitionQuery(definition).pipe(sqlError("AutomationRepository.upsertDefinition")),
    getDefinition: (automationId) =>
      getDefinitionQuery({ automationId }).pipe(
        Effect.map(Option.map((row) => row.value)),
        sqlError("AutomationRepository.getDefinition"),
      ),
    listDefinitions: (input) =>
      listDefinitionsQuery(input).pipe(
        Effect.map((rows) => rows.map((row) => row.value)),
        sqlError("AutomationRepository.listDefinitions"),
      ),
    listDueDefinitions: (input) =>
      listDueDefinitionsQuery(input).pipe(
        Effect.map((rows) => rows.map((row) => row.value)),
        sqlError("AutomationRepository.listDueDefinitions"),
      ),
    softDeleteDefinition: (input) =>
      softDeleteDefinitionQuery(input).pipe(sqlError("AutomationRepository.softDeleteDefinition")),
    insertRun: (run) =>
      insertRunQuery(run).pipe(
        Effect.map(Option.map((row) => row.value)),
        sqlError("AutomationRepository.insertRun"),
      ),
    upsertRun: (run) => upsertRunQuery(run).pipe(sqlError("AutomationRepository.upsertRun")),
    getRun: (runId) =>
      getRunQuery({ runId }).pipe(
        Effect.map(Option.map((row) => row.value)),
        sqlError("AutomationRepository.getRun"),
      ),
    listRuns: (input) =>
      listRunsQuery(input).pipe(
        Effect.map((rows) => rows.map((row) => row.value)),
        sqlError("AutomationRepository.listRuns"),
      ),
    claimNextRun: (input) =>
      claimNextRunQuery(input).pipe(
        Effect.map(Option.map((row) => row.value)),
        sqlError("AutomationRepository.claimNextRun"),
      ),
    renewRunLease: (input) =>
      renewRunLeaseQuery(input).pipe(
        Effect.map(Option.map((row) => row.value)),
        sqlError("AutomationRepository.renewRunLease"),
      ),
    appendRunEvent: (event) =>
      appendRunEventQuery(event).pipe(sqlError("AutomationRepository.appendRunEvent")),
    listRunEvents: (runId) =>
      listRunEventsQuery({ runId }).pipe(
        Effect.map((rows) => rows.map((row) => row.value)),
        sqlError("AutomationRepository.listRunEvents"),
      ),
  } satisfies AutomationRepositoryShape);
});

export const AutomationRepositoryLive = Layer.effect(
  AutomationRepository,
  makeAutomationRepository,
);
