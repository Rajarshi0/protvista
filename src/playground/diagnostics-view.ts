/**
 * Owns the config pane's validation footer — the summary line plus the
 * error list. Both render paths (live config diagnostics and runtime
 * `protvista-error` issues) go through here, so the pluralised summary
 * text and the `<li>` construction live in exactly one place.
 */

/** The minimal shape this view renders from a diagnostic or an issue. */
interface Renderable {
  message: string;
  code?: string;
  /** Absent means `'error'`, matching `ValidationIssue.severity`. */
  severity?: 'error' | 'warning';
}

export interface DiagnosticsView {
  /**
   * Replace the list with the current config diagnostics and update the
   * summary. Returns whether the config is valid — that is, whether it is
   * free of *errors*. A warning is listed but does not make the config
   * unloadable, so it must not hold the preview back.
   */
  showConfig(diagnostics: readonly Renderable[]): boolean;
  /**
   * Append runtime issues (from a `protvista-error` event) and refresh the
   * summary count. With no issues, lists the event's own `message` — a
   * viewer-scoped warning or a track failure carries no `issues` — at the
   * event's `severity`, falling back to a generic line when neither is given.
   */
  appendRuntime(
    issues: readonly Renderable[] | undefined,
    phase?: string,
    message?: string,
    severity?: 'error' | 'warning'
  ): void;
}

export function createDiagnosticsView(
  summary: HTMLElement,
  list: HTMLElement
): DiagnosticsView {
  const setSummary = (count: number, errors = count): void => {
    if (count === 0) {
      summary.textContent = 'No problems — config is valid.';
      return;
    }
    // Warnings alone leave the config loadable, and the summary is the line
    // an author reads before deciding whether to hit Run.
    summary.textContent =
      errors === 0
        ? `${count} warning${count === 1 ? '' : 's'} — config is valid.`
        : `${count} problem${count === 1 ? '' : 's'} found:`;
  };

  const item = (
    message: string,
    code?: string,
    severity?: 'error' | 'warning'
  ): HTMLLIElement => {
    const li = document.createElement('li');
    li.textContent = message;
    if (code) li.dataset.code = code;
    // Only warnings are marked: the list is styled as errors by default, so
    // an unmarked row keeps exactly the appearance it had.
    if (severity === 'warning') li.dataset.severity = 'warning';
    return li;
  };

  return {
    showConfig(diagnostics) {
      const errors = diagnostics.filter(
        (d) => (d.severity ?? 'error') === 'error'
      ).length;
      setSummary(diagnostics.length, errors);
      list.replaceChildren(
        ...diagnostics.map((d) => item(d.message, d.code, d.severity))
      );
      return errors === 0;
    },

    appendRuntime(issues, phase, message, severity) {
      const rows: readonly Renderable[] =
        issues && issues.length > 0
          ? issues
          : [
              {
                message: message ?? 'A track failed to load its data.',
                code: 'runtime',
                severity,
              },
            ];
      for (const issue of rows) {
        list.append(
          item(
            phase ? `[${phase}] ${issue.message}` : issue.message,
            issue.code ?? 'runtime',
            issue.severity
          )
        );
      }
      // Count from the list, not from this call: it also holds the config
      // diagnostics and earlier runtime rows, and a warning among them must
      // not read as a problem.
      const errors = [...list.children].filter(
        (li) => (li as HTMLElement).dataset.severity !== 'warning'
      ).length;
      setSummary(list.childElementCount, errors);
    },
  };
}
