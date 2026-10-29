// 답변 카드 (PLAN 14번, DESIGN.md 2장 "답변 카드")
// 결론 요약 → 상세 설명 → 근거 조문(시행일) → 관련 사례 → 참고용 문구 순서로 보여 준다.
// 답변 종류(일반/되묻기/범위 밖/근거 없음)마다 보이는 칸이 다르다 (DESIGN.md 3장 표).
import { isInterpretationNumber, type CaseRef, type StructuredAnswer } from "@/lib/answer";

// PRD 5장: 모든 답변 끝에 붙는 문구. AI가 빠뜨리지 않도록 화면이 직접 붙인다.
const DISCLAIMER = "참고용 정보이며, 최종 판단은 법무 부서에 확인하세요.";

export default function AnswerCard({
  answer,
  notice,
}: {
  answer: StructuredAnswer;
  notice?: string | null;
}) {
  return (
    <article className="w-full max-w-[90%] rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-5 py-4 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
      {answer.type === "answer" && <GeneralAnswer answer={answer} />}

      {answer.type === "clarify" && (
        <div>
          <p className="text-base">정확히 답하려면 몇 가지를 더 알려 주세요.</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-base">
            {answer.clarifyQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}

      {(answer.type === "out_of_scope" || answer.type === "no_basis") && (
        <p className="whitespace-pre-wrap text-base">{answer.notice}</p>
      )}

      {/* 예: 국가법령정보센터 조회 실패 안내 (DESIGN.md 2장) */}
      {notice && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </p>
      )}

      <p className="mt-4 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {DISCLAIMER}
      </p>
    </article>
  );
}

// 사례 카드 하나 (PLAN 15번, DESIGN.md 2장 "사례 카드")
// 사건번호·날짜·법원(기관)명을 따로 표시하고, 요지는 2줄을 넘으면 잘라서 보여 준다.
// 유권해석(법령해석례)은 안건번호·회신일·회신기관으로 이름표를 바꿔 보여 준다.
function CaseItem({ item }: { item: CaseRef }) {
  const interpretation = isInterpretationNumber(item.caseNumber);
  return (
    <li className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
      {interpretation && (
        <p className="mb-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">유권해석(법령해석례)</p>
      )}
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
        <div className="flex gap-1">
          <dt className="text-zinc-500 dark:text-zinc-400">{interpretation ? "안건번호" : "사건번호"}</dt>
          <dd className="font-semibold">{item.caseNumber}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-zinc-500 dark:text-zinc-400">{interpretation ? "회신일" : "선고(재결)일"}</dt>
          <dd>{item.date.replace(/\.?$/, ".")}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-zinc-500 dark:text-zinc-400">{interpretation ? "회신기관" : "법원·기관"}</dt>
          <dd>{item.court}</dd>
        </div>
      </dl>
      <p className="mt-1 line-clamp-2 text-zinc-700 dark:text-zinc-300" title={item.gist}>
        {item.gist}
      </p>
      {/* PRD 7장: 일부만 공개된 자료 안내 */}
      {item.partiallyPublic && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          비공개 부분은 제공할 수 없습니다.
        </p>
      )}
    </li>
  );
}

function GeneralAnswer({ answer }: { answer: StructuredAnswer }) {
  return (
    <div className="space-y-4">
      {/* 결론 요약: 강조 상자 */}
      <section className="rounded-lg bg-blue-50 px-4 py-3 dark:bg-blue-950">
        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200">결론</h3>
        <p className="mt-1 text-base leading-relaxed">{answer.summary.join(" ")}</p>
      </section>

      {/* 상세 설명 */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">자세한 설명</h3>
        <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{answer.detail}</p>
      </section>

      {/* 근거 조문: 조문마다 시행일 표시 */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">근거 조문</h3>
        <ul className="mt-1 space-y-1">
          {answer.legalBasis.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-base">
              <span>
                {b.law} {b.article}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {b.effectiveDate.replace(/\.?$/, ".")} 시행
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 관련 사례: 최대 3건 (PRD 5장 must ②) */}
      {answer.cases.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            관련 사례 ({answer.cases.length}건)
          </h3>
          <ul className="mt-1 space-y-2">
            {answer.cases.map((c, i) => (
              <CaseItem key={i} item={c} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
