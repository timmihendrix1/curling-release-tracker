type AssessmentComparisonEligibilityNoticeProps = {
  eligible: boolean;
  reasonMessages: string[];
};

/** Comparison Eligibility disclosure — see Phase C brief section 12. Never shows a raw enum value. */
export default function AssessmentComparisonEligibilityNotice({
  eligible,
  reasonMessages,
}: AssessmentComparisonEligibilityNoticeProps) {
  if (eligible) {
    return (
      <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800" role="status">
        This run remains protocol-comparable.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800" role="status">
      <p className="font-medium">Not directly comparable.</p>
      {reasonMessages.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {reasonMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
