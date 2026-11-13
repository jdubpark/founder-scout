import { useRef, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { SourceIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { ErrorNote, Panel, SkeletonRows } from "../../components/ui/layout";
import { useToast } from "../../components/ui/overlay";
import { ago, count, plural } from "../../lib/format";
import { useImportNetwork, useNetwork, useRemoveNetwork } from "../../lib/queries";
import { InfoHint } from "../steering/InfoHint";

const EXPORT_HINT =
  "Export your connections from your own account settings, then upload the file here. Names, companies and positions are kept; email addresses are not.";

/** The partners' uploaded professional-network connection lists, one row per uploader. */
export function NetworkPanel() {
  const network = useNetwork();
  const importNetwork = useImportNetwork();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the picker so choosing the same file again still fires a change.
    event.target.value = "";
    if (!file) return;
    const csv = await file.text();
    importNetwork.mutate(
      { csv },
      {
        onSuccess: (result) =>
          toast.done(`${count(result.imported)} contacts, ${plural(result.leads, "new founder")}`),
        onError: (failure) => toast.problem("The connections were not uploaded", failure.message),
      },
    );
  };

  const owners = network.data?.owners ?? [];

  return (
    <Panel title="Your network" aside={network.data && network.data.total > 0 ? count(network.data.total) : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-label="Connections file"
            onChange={upload}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload />}
            onClick={() => inputRef.current?.click()}
            busy={importNetwork.isPending}
            busyLabel="Uploading"
          >
            Upload connections
          </Button>
          <InfoHint text={EXPORT_HINT} />
        </div>

        {network.error ? (
          <ErrorNote title="Connections could not be loaded">{network.error.message}</ErrorNote>
        ) : network.isPending ? (
          <SkeletonRows rows={2} />
        ) : owners.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {owners.map((row) => (
              <NetworkRow key={row.owner} owner={row.owner} contacts={row.contacts} importedAt={row.importedAt} />
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

function NetworkRow({ owner, contacts, importedAt }: { owner: string; contacts: number; importedAt: string }) {
  const remove = useRemoveNetwork();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const removeOwner = () =>
    remove.mutate(owner, {
      onSuccess: () => {
        setConfirming(false);
        toast.done("Connections removed");
      },
      onError: (failure) => toast.problem("The connections were not removed", failure.message),
    });

  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
      <SourceIcon source="network" className="text-ink-2" />
      <span className="min-w-0 flex-1 truncate text-base font-bold text-ink" title={owner}>
        {owner}
      </span>
      <span className="figure text-sm font-bold text-ink">{count(contacts)}</span>
      <span className="w-20 shrink-0 text-right text-sm text-ink-3">{ago(importedAt)}</span>
      {confirming ? (
        <span className="flex shrink-0 gap-2">
          <Button size="sm" onClick={removeOwner} busy={remove.isPending} busyLabel="Removing">
            Confirm
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setConfirming(false)} disabled={remove.isPending}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
    </li>
  );
}
