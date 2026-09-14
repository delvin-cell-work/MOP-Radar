import { agentDetails } from "@/lib/agent";
import { MOP_DISCLOSURE } from "@/lib/compliance";

/**
 * Shared footer rendered by the root layout on every route: the MOP disclosure
 * and, always visible, the salesperson's and agency's CEA details.
 */
export function SiteFooter() {
  const agent = agentDetails();

  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] leading-snug text-slate-600 sm:text-xs">
      <p>{MOP_DISCLOSURE}</p>
      {agent ? (
        <p className="mt-0.5 text-slate-700">
          <span className="whitespace-nowrap">{agent.name}</span>
          {" · "}
          <span className="whitespace-nowrap">CEA Reg. No. {agent.ceaRegNo}</span>
          {" · "}
          <span className="whitespace-nowrap">{agent.agencyName}</span>
          {" · "}
          <span className="whitespace-nowrap">Licence No. {agent.agencyLicenceNo}</span>
        </p>
      ) : (
        // Only reachable in development: production builds fail without these details.
        <p className="mt-0.5 font-semibold text-red-700">
          Agent CEA details are missing. Set the NEXT_PUBLIC_ agent variables in .env.local.
        </p>
      )}
    </footer>
  );
}
