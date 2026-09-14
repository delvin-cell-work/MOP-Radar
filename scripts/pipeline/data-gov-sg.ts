import { z } from "zod";

import { PipelineError } from "./errors";
import {
  datastoreResponseSchema,
  describeDataset,
  metadataResponseSchema,
  pollDownloadResponseSchema,
  type DatasetDefinition,
} from "./schemas";

/**
 * data.gov.sg client for the build pipeline. Never import this from the app:
 * the browser only reads the static JSON in public/data/.
 *
 * Unauthenticated requests are rate limited (HTTP 429 or {"code":24}, "try
 * again in N seconds"), so requests run one at a time and honour that wait.
 */

const USER_AGENT = "mop-radar-data-pipeline";
const DATASTORE_URL = "https://data.gov.sg/api/action/datastore_search";
const metadataUrl = (id: string) => `https://api-production.data.gov.sg/v2/public/api/datasets/${id}/metadata`;
const pollDownloadUrl = (id: string) => `https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`;

const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 120_000;
/** The building footprint GeoJSON is ~57 MB and took ~3 minutes to download in Sep 2026. */
const DOWNLOAD_TIMEOUT_MS = 600_000;
/** datastore_search rejects a 10,000-row page of HDB Property Information with HTTP 413. */
const PAGE_SIZE = 5_000;
const MIN_PAGE_SIZE = 500;
const PAGE_DELAY_MS = 2_000;
const DOWNLOAD_POLL_ATTEMPTS = 12;
const DOWNLOAD_POLL_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** poll-download answers a successful request with 201, so accept any 2xx. */
const isSuccess = (status: number) => status >= 200 && status < 300;
const backoffMs = (attempt: number) => Math.min(60_000, 2_000 * 2 ** (attempt - 1));

interface HttpResult {
  status: number;
  body: string;
}

function rateLimitWaitSeconds({ status, body }: HttpResult): number | null {
  const limited =
    status === 429 || (body.length < 10_000 && /"code"\s*:\s*24\b|TOO_MANY_REQUESTS/.test(body));
  if (!limited) return null;
  const match = /try again in (\d+) seconds?/i.exec(body);
  return match ? Number(match[1]) : 10;
}

async function request(url: string, label: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<HttpResult> {
  let lastProblem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let delay = backoffMs(attempt);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const result = { status: response.status, body: await response.text() };
      const waitSeconds = rateLimitWaitSeconds(result);
      if (waitSeconds === null && result.status < 500) return result;
      if (waitSeconds !== null) {
        lastProblem = "rate limited";
        delay = (waitSeconds + 1) * 1000;
      } else {
        lastProblem = `HTTP ${result.status}`;
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`  ↻ ${label}: ${lastProblem}; retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
  throw new PipelineError(`${label}: giving up after ${MAX_ATTEMPTS} attempts (${lastProblem}).\n  ${url}`);
}

function parseJson(result: HttpResult, dataset: DatasetDefinition, url: string): unknown {
  try {
    return JSON.parse(result.body);
  } catch {
    throw new PipelineError(
      `${describeDataset(dataset)}: expected JSON (HTTP ${result.status}) from ${url}\n  ${result.body.slice(0, 300)}`,
    );
  }
}

class PageTooLargeError extends PipelineError {}

export interface DatastorePage {
  fields: string[];
  records: unknown[];
  total: number;
}

export async function fetchDatastorePage(
  dataset: DatasetDefinition,
  limit: number,
  offset: number,
): Promise<DatastorePage> {
  const url = `${DATASTORE_URL}?resource_id=${dataset.id}&limit=${limit}&offset=${offset}`;
  const result = await request(url, dataset.name);
  if (result.status === 413) {
    throw new PageTooLargeError(`${describeDataset(dataset)}: datastore page of ${limit} rows is too large`);
  }
  const parsed = datastoreResponseSchema.safeParse(parseJson(result, dataset, url));
  if (!parsed.success) {
    throw new PipelineError(
      `${describeDataset(dataset)}: unexpected datastore_search response (HTTP ${result.status}). ` +
        `The resource ID may have changed or been retired.\n` +
        `${z.prettifyError(parsed.error)}\n  Response: ${result.body.slice(0, 300)}`,
    );
  }
  const { resource_id, fields, records, total } = parsed.data.result;
  if (resource_id !== dataset.id) {
    throw new PipelineError(`${describeDataset(dataset)}: datastore returned resource ${resource_id}`);
  }
  return { fields: fields.map((field) => field.id), records, total };
}

/** Fetches every record, halving the page size if data.gov.sg rejects it as too large. */
export async function fetchDatastore(dataset: DatasetDefinition): Promise<DatastorePage> {
  let limit = PAGE_SIZE;
  let offset = 0;
  let first: DatastorePage | null = null;
  const records: unknown[] = [];

  for (;;) {
    let page: DatastorePage;
    try {
      page = await fetchDatastorePage(dataset, limit, offset);
    } catch (error) {
      if (error instanceof PageTooLargeError && limit > MIN_PAGE_SIZE) {
        limit = Math.max(MIN_PAGE_SIZE, Math.floor(limit / 2));
        console.warn(`  ↻ ${dataset.name}: page too large, retrying with ${limit} rows`);
        continue;
      }
      throw error;
    }

    if (!first) {
      first = page;
    } else if (page.total !== first.total) {
      throw new PipelineError(
        `${describeDataset(dataset)}: record total changed mid-fetch (${first.total} → ${page.total}). ` +
          "The dataset is being updated; re-run shortly.",
      );
    }

    records.push(...page.records);
    offset += page.records.length;
    console.log(`  ${dataset.name}: ${records.length.toLocaleString("en-SG")} / ${page.total.toLocaleString("en-SG")}`);
    if (page.records.length === 0 || offset >= page.total) break;
    await sleep(PAGE_DELAY_MS);
  }

  if (records.length !== first.total) {
    throw new PipelineError(
      `${describeDataset(dataset)}: fetched ${records.length} records but the datastore reports ${first.total}`,
    );
  }
  return { fields: first.fields, records, total: first.total };
}

export interface DatasetMetadata {
  name: string;
  lastUpdatedAt: string;
  coverageEnd: string | null;
}

/** Confirms the ID still resolves to the dataset we expect, by exact name. */
export async function fetchDatasetMetadata(dataset: DatasetDefinition): Promise<DatasetMetadata> {
  const url = metadataUrl(dataset.id);
  const result = await request(url, `${dataset.name} metadata`);
  const parsed = metadataResponseSchema.safeParse(parseJson(result, dataset, url));
  if (!isSuccess(result.status) || !parsed.success) {
    throw new PipelineError(
      `${describeDataset(dataset)}: could not load dataset metadata (HTTP ${result.status}). ` +
        `The dataset ID may have changed or been retired.\n  Response: ${result.body.slice(0, 300)}`,
    );
  }
  const { datasetId, name, lastUpdatedAt, coverageEnd } = parsed.data.data;
  if (datasetId !== dataset.id || name !== dataset.name) {
    throw new PipelineError(
      `${dataset.id} now resolves to "${name}" (${datasetId}), expected "${dataset.name}". ` +
        "Confirm the ID on data.gov.sg, then update scripts/pipeline/schemas.ts.",
    );
  }
  return { name, lastUpdatedAt, coverageEnd: coverageEnd ?? null };
}

/** Whole-dataset file (CSV or GeoJSON) via the poll-download pattern: one signed S3 URL. */
export async function fetchDatasetDownload(dataset: DatasetDefinition): Promise<string> {
  const url = pollDownloadUrl(dataset.id);
  let lastStatus = "unknown";

  for (let attempt = 1; attempt <= DOWNLOAD_POLL_ATTEMPTS; attempt++) {
    const result = await request(url, `${dataset.name} download`);
    const parsed = pollDownloadResponseSchema.safeParse(parseJson(result, dataset, url));
    if (!isSuccess(result.status) || !parsed.success) {
      throw new PipelineError(
        `${describeDataset(dataset)}: unexpected poll-download response (HTTP ${result.status}).\n` +
          `  Response: ${result.body.slice(0, 300)}`,
      );
    }

    const { url: fileUrl, status } = parsed.data.data;
    if (fileUrl) {
      console.log(`  ${dataset.name}: downloading file`);
      const file = await request(fileUrl, `${dataset.name} file`, DOWNLOAD_TIMEOUT_MS);
      if (!isSuccess(file.status)) {
        throw new PipelineError(`${describeDataset(dataset)}: download failed with HTTP ${file.status}`);
      }
      return file.body;
    }

    lastStatus = status ?? "no status";
    console.warn(`  ↻ ${dataset.name}: download not ready (${lastStatus}); polling again`);
    await sleep(DOWNLOAD_POLL_DELAY_MS);
  }

  throw new PipelineError(
    `${describeDataset(dataset)}: download never became ready (last status: ${lastStatus})`,
  );
}
