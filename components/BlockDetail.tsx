"use client";

import { blockEnquiryMessage, whatsappLink, type AgentContact } from "@/lib/agent";
import type { DerivedBlock } from "@/lib/data-contract";
import { blockTitle, formatNumber } from "@/lib/format";
import { sparklineSeries, type Transaction } from "@/lib/transactions";

import { BlockSummary } from "./BlockSummary";
import { MopStatusChip } from "./MopStatusChip";
import { PriceSparkline } from "./PriceSparkline";
import { TransactionTable } from "./TransactionTable";

interface BlockDetailProps {
  block: DerivedBlock;
  townName: string;
  priceWindow: string;
  /** Null while loading. */
  transactions: readonly Transaction[] | null;
  transactionsError: string | null;
  onRetry: () => void;
  agent: AgentContact | null;
}

export function BlockDetail({
  block,
  townName,
  priceWindow,
  transactions,
  transactionsError,
  onRetry,
  agent,
}: BlockDetailProps) {
  const series = transactions ? sparklineSeries(transactions) : null;

  return (
    <div className="space-y-5 pb-2">
      <section aria-label="Summary">
        <MopStatusChip status={block.mop_status} />
        <BlockSummary block={block} priceWindow={priceWindow} />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Completed</dt>
            <dd className="text-slate-800">{block.year_completed}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Storeys</dt>
            <dd className="text-slate-800">{block.max_floor_lvl}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Flats in block</dt>
            <dd className="text-slate-800">{formatNumber(block.total_dwelling_units)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Resales since Jan 2017</dt>
            <dd className="text-slate-800">{formatNumber(block.transaction_count)}</dd>
          </div>
        </dl>
      </section>

      {agent && (
        <a
          href={whatsappLink(agent.whatsapp, blockEnquiryMessage(agent.name, blockTitle(block), townName))}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-green-700 px-4 text-center font-semibold text-white hover:bg-green-800"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current" aria-hidden="true">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z" />
          </svg>
          Ask {agent.name} about this block
        </a>
      )}

      <section aria-labelledby="resale-history-heading">
        <h3 id="resale-history-heading" className="text-sm font-semibold text-slate-900">
          Resale history
        </h3>
        <div className="mt-2 space-y-3">
          {transactionsError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p>{transactionsError}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 min-h-[44px] rounded-lg bg-red-900 px-4 font-semibold text-white"
              >
                Try again
              </button>
            </div>
          ) : transactions === null ? (
            <div aria-hidden="true" className="h-40 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
          ) : transactions.length === 0 ? (
            <p className="text-sm text-slate-700">No resales on record for this block since Jan 2017.</p>
          ) : (
            <>
              {series && <PriceSparkline series={series} />}
              <TransactionTable transactions={transactions} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
