import { IntegrationListRunsInput, IntegrationRun, IntegrationRunId } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  IntegrationRunRepository,
  type IntegrationRunRepositoryShape,
} from "../Services/IntegrationRunRepository.ts";

const Row = Schema.Struct({ value: Schema.fromJsonString(IntegrationRun) });
const IdInput = Schema.Struct({ id: IntegrationRunId });
const TransitionInput = Schema.Struct({
  run: IntegrationRun,
  from: Schema.Array(IntegrationRun.fields.state),
});
const PruneInput = Schema.Struct({ before: Schema.String });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const insert = SqlSchema.void({
    Request: IntegrationRun,
    execute: (run) => sql`
    INSERT INTO integration_runs (run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at)
    VALUES (${run.id}, ${run.source}, ${run.state}, ${run.projectId}, ${run.parentRunId}, ${run.attempt}, ${JSON.stringify(run)}, ${run.createdAt}, ${run.updatedAt}, ${run.completedAt})
  `,
  });
  const get = SqlSchema.findOneOption({
    Request: IdInput,
    Result: Row,
    execute: ({ id }) => sql`SELECT run_json AS value FROM integration_runs WHERE run_id = ${id}`,
  });
  const list = SqlSchema.findAll({
    Request: IntegrationListRunsInput,
    Result: Row,
    execute: ({ source, state, projectId, cursor, limit = 50 }) => sql`
    SELECT run_json AS value FROM integration_runs
    WHERE (${source ?? null} IS NULL OR source = ${source ?? null})
      AND (${state ?? null} IS NULL OR state = ${state ?? null})
      AND (${projectId ?? null} IS NULL OR project_id = ${projectId ?? null})
      AND (${cursor?.createdAt ?? null} IS NULL OR (created_at < ${cursor?.createdAt ?? null} OR (created_at = ${cursor?.createdAt ?? null} AND run_id < ${cursor?.id ?? null})))
    ORDER BY created_at DESC, run_id DESC LIMIT ${limit + 1}
  `,
  });
  const transition = SqlSchema.findAll({
    Request: TransitionInput,
    Result: Schema.Struct({ run_id: Schema.String }),
    execute: ({ run, from }) => sql`
    UPDATE integration_runs SET state = ${run.state}, run_json = ${JSON.stringify(run)}, updated_at = ${run.updatedAt}, completed_at = ${run.completedAt}
    WHERE run_id = ${run.id} AND state IN (${sql.in(from)}) RETURNING run_id
  `,
  });
  const prune = SqlSchema.findAll({
    Request: PruneInput,
    Result: Schema.Struct({ run_id: Schema.String }),
    execute: ({ before }) => sql`
    DELETE FROM integration_runs WHERE completed_at IS NOT NULL AND completed_at < ${before} RETURNING run_id
  `,
  });
  const mapError = (operation: string) => Effect.mapError(toPersistenceSqlError(operation));
  return IntegrationRunRepository.of({
    insert: (run) => insert(run).pipe(mapError("IntegrationRunRepository.insert")),
    get: (id) =>
      get({ id }).pipe(
        Effect.map(Option.map((row) => row.value)),
        mapError("IntegrationRunRepository.get"),
      ),
    list: (input) =>
      list(input).pipe(
        Effect.map((rows) => rows.map((row) => row.value)),
        mapError("IntegrationRunRepository.list"),
      ),
    transition: (input, from) =>
      transition({ run: input, from: [...from] }).pipe(
        Effect.map((rows) => rows.length === 1),
        mapError("IntegrationRunRepository.transition"),
      ),
    pruneCompletedBefore: (before) =>
      prune({ before }).pipe(
        Effect.map((rows) => rows.length),
        mapError("IntegrationRunRepository.pruneCompletedBefore"),
      ),
  } satisfies IntegrationRunRepositoryShape);
});
export const IntegrationRunRepositoryLive = Layer.effect(IntegrationRunRepository, make);
