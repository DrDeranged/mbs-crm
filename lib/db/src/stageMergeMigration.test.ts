import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

test(
  "migration 028 moves going-to-funding deals and writes system stage history",
  { skip: !databaseUrl },
  async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `stage_merge_${randomUUID().replaceAll("-", "")}`;
    const migration = await readFile(
      new URL("../migrations/028_merge_going_to_funding_stage.sql", import.meta.url),
      "utf8",
    );

    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE deals (
          id serial PRIMARY KEY,
          lead_id integer,
          stage text NOT NULL
            CONSTRAINT deals_stage_check
            CHECK (stage IN (
              'waiting_on_app',
              'information_needed',
              'submitted',
              'approved',
              'going_to_funding',
              'in_funding',
              'funded',
              'declined',
              'dead',
              'hold_on'
            )),
          updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE activity_log (
          id serial PRIMARY KEY,
          user_id integer,
          lead_id integer,
          deal_id integer,
          action text NOT NULL,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          details jsonb,
          created_at timestamp NOT NULL DEFAULT now()
        );
      `);
      const seeded = await client.query<{ id: number }>(
        "INSERT INTO deals (lead_id, stage) VALUES (42, 'going_to_funding') RETURNING id",
      );

      await client.query(migration);

      const deal = await client.query<{ stage: string }>(
        "SELECT stage FROM deals WHERE id = $1",
        [seeded.rows[0].id],
      );
      assert.equal(deal.rows[0].stage, "in_funding");

      const history = await client.query<{
        user_id: number | null;
        action: string;
        message: string;
        previous_stage: string;
        next_stage: string;
      }>(
        `SELECT
           user_id,
           action,
           details->>'message' AS message,
           details->>'from' AS previous_stage,
           details->>'to' AS next_stage
         FROM activity_log
         WHERE deal_id = $1`,
        [seeded.rows[0].id],
      );
      assert.equal(history.rowCount, 1);
      assert.deepEqual(history.rows[0], {
        user_id: null,
        action: "stage_changed",
        message: "Stage merged: Going to Funding → In Funding",
        previous_stage: "going_to_funding",
        next_stage: "in_funding",
      });

      await assert.rejects(
        client.query("INSERT INTO deals (stage) VALUES ('going_to_funding')"),
        /deals_stage_check/,
      );
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  },
);