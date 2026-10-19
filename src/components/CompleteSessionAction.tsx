type Props = {
  onComplete: () => void;
  disabled: boolean;
  subtle?: boolean;
  errorMessage?: string | null;
  onRetry?: (() => void) | null;
};

/** Presentation only: the application shell still owns the guarded archive. */
export default function CompleteSessionAction({ onComplete, disabled, subtle = false, errorMessage, onRetry }: Props) {
  return (
    <div className="space-y-2">
      <button type="button" onClick={onComplete} disabled={disabled}
        className={subtle ? "house-flow-link w-full" : "house-flow-secondary"}>
        Complete Session
      </button>
      {errorMessage && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <p>{errorMessage}</p>
          {onRetry && <button type="button" onClick={onRetry} className="mt-2 min-h-11 underline">Try Saving Again</button>}
        </div>
      )}
    </div>
  );
}
