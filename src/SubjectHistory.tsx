import { useState } from "react";
import { Check, X, ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { formatClassRange, facultyLabel } from "./schedule";
import {
  historyDate,
  historyTone,
  type HistoryClass,
} from "./subjectHistoryModel";
export function SubjectHistory({
  name,
  rows,
  loading,
  error,
  retry,
  loadOlder,
  olderLoading,
  olderError,
  range,
}: {
  name: string;
  rows: HistoryClass[];
  loading: boolean;
  error: string;
  retry: () => void;
  loadOlder: () => Promise<boolean>;
  olderLoading: boolean;
  olderError: string;
  range: string;
}) {
  const [expanded, setExpanded] = useState(false),
    [visible, setVisible] = useState(5),
    [requesting, setRequesting] = useState(false);
  const label = (row: HistoryClass) =>
    `${historyDate(row.date)}, ${formatClassRange(row.slot)}: ${row.status === "Not marked" ? "No attendance marked" : row.status}`;
  async function more() {
    if (rows.length > visible) {
      setVisible((n) => n + 5);
      return;
    }
    setRequesting(true);
    try {
      if (await loadOlder()) setVisible((n) => n + 5);
    } finally {
      setRequesting(false);
    }
  }
  return (
    <div className="subject-history" data-tour="subject-history">
      <div className="history-strip-header">
        <span>
          Last 5 classes <small>newest first</small>
        </span>
        <button
          className="history-toggle"
          aria-label={`${expanded ? "Hide" : "Show"} recent classes for ${name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={18} />
        </button>
      </div>
      <div className="history-five" aria-label={`${name} recent attendance`}>
        {Array.from({ length: 5 }, (_, i) => {
          const row = rows[i];
          return row ? (
            <button
              key={row.key}
              className={`history-box ${historyTone(row.status)}`}
              title={label(row)}
              aria-label={label(row)}
              onClick={() => setExpanded(true)}
            >
              {row.status === "Present" ? (
                <Check size={17} />
              ) : row.status === "Absent" ? (
                <X size={17} />
              ) : (
                <span aria-hidden="true">·</span>
              )}
              <small>
                {row.status === "Present"
                  ? "Present"
                  : row.status === "Absent"
                    ? "Absent"
                    : row.status === "Not marked"
                      ? "No mark"
                      : row.status}
              </small>
            </button>
          ) : (
            <span
              className="history-box empty"
              key={i}
              aria-label={loading ? "Loading class" : "No earlier class loaded"}
            >
              —
            </span>
          );
        })}
      </div>
      {loading && (
        <p role="status" className="history-note">
          <LoaderCircle size={13} className="spin" /> Loading your recent
          classes…
        </p>
      )}
      {error && (
        <p role="alert" className="history-error">
          {error}{" "}
          <button className="text-button" onClick={retry}>
            Retry history
          </button>
        </p>
      )}
      {expanded && (
        <div className="history-expanded">
          <p className="history-note">
            {range}. Missing attendance stays unmarked.
          </p>
          {rows.slice(0, visible).map((row) => (
            <div className="history-detail" key={row.key}>
              <div>
                <time dateTime={row.date}>{historyDate(row.date)}</time>
                <strong>{formatClassRange(row.slot)}</strong>
                <span>{facultyLabel(row.slot)}</span>
                {row.slot.isSuspended && <span>Cancelled class</span>}
              </div>
              <span className={`history-result ${historyTone(row.status)}`}>
                {row.status === "Not marked"
                  ? "No attendance marked"
                  : row.status}
              </span>
            </div>
          ))}
          {!rows.length && !loading && (
            <p className="history-note">
              No completed classes found in the loaded months.
            </p>
          )}
          <button
            className="button secondary history-more"
            disabled={loading || olderLoading || requesting}
            onClick={more}
          >
            {olderLoading || requesting ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Plus size={14} />
            )}{" "}
            {rows.length > visible
              ? "Load more classes"
              : "Load more · earlier month"}
          </button>
          {olderError && (
            <p className="history-error" role="alert">
              {olderError} Try loading the earlier month again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
