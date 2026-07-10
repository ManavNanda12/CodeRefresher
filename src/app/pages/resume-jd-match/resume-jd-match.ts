import { Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';
import { MemeService, MemeResult } from '../../core/services/meme.service';
import {
  JdMatchReport,
  MatchVerdict,
  ResumeJdMatchService,
} from '../../services/resume-jd-match/resume-jd-match.service';

type Stage = 'intro' | 'matching' | 'results';

const MAX_FILE_MB = 10;
const MIN_RESUME_CHARS = 150;
const MIN_JD_CHARS = 120;

/** Rotating status lines while the recruiter reads both documents. */
const MATCH_STATUS = [
  'Reading the job description…',
  'Highlighting the must-haves…',
  'Scanning your résumé for evidence…',
  'Running the ATS keyword pass…',
  'Weighing the gaps against the wins…',
];

const VERDICT_META: Record<MatchVerdict, { label: string; icon: string; color: string; blurb: string }> = {
  strong: { label: 'Strong match', icon: '🎯', color: '#34d399',
    blurb: 'This résumé should sail through the screen. Apply.' },
  good: { label: 'Good match', icon: '👍', color: '#60a5fa',
    blurb: 'Solid fit — a little tailoring makes it a strong yes.' },
  partial: { label: 'Partial match', icon: '😬', color: '#fbbf24',
    blurb: 'Some real gaps. Close what you can, reframe the rest.' },
  weak: { label: 'Long shot', icon: '🥲', color: '#f87171',
    blurb: 'Big gaps for this one — or a résumé that hides your fit.' },
};

@Component({
  selector: 'app-resume-jd-match',
  imports: [RouterLink, FormsModule, DecimalPipe],
  templateUrl: './resume-jd-match.html',
  styleUrl: './resume-jd-match.css',
})
export class ResumeJdMatchComponent implements OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private svc = inject(ResumeJdMatchService);
  private memeSvc = inject(MemeService);

  readonly VERDICT_META = VERDICT_META;
  readonly MIN_JD_CHARS = MIN_JD_CHARS;

  private statusTimer: ReturnType<typeof setInterval> | null = null;

  // ── State machine ───────────────────────────────────────────
  stage = signal<Stage>('intro');

  // Intro: résumé side (upload or paste) + JD side (paste)
  resumeText = signal('');
  resumeSource = signal('');   // 'file.pdf' or 'pasted text' — shown on the loaded chip
  pasteMode = signal(false);
  pasteText = signal('');
  dragOver = signal(false);
  fileBusy = signal(false);
  jdText = signal('');
  introError = signal('');

  // Matching
  matchStatus = signal(MATCH_STATUS[0]);

  // Results
  report = signal<JdMatchReport | null>(null);
  /** Animated 0→score sweep for the ring. */
  displayScore = signal(0);
  tipOpen = signal<Set<string>>(new Set());
  meme = signal<MemeResult | null>(null);
  memeFailed = signal(false);

  constructor() {
    inject(SeoService).update({
      title: 'Résumé × JD Match — Will Your CV Pass the Screen?',
      description:
        'Paste a job description next to your résumé and get a recruiter-grade match report: score, proven skills, real gaps, and concrete tailoring edits for that exact application.',
      keywords: 'resume jd match, resume job description match, ats resume checker, resume keyword match, resume tailoring',
    });
  }

  ngOnDestroy(): void {
    this.stopStatusTimer();
  }

  // ── Intro: résumé upload / paste (same client-side pdf.js flow as the interview) ──
  readonly resumeReady = computed(() => this.resumeText().length >= MIN_RESUME_CHARS);
  readonly jdReady = computed(() => this.jdText().trim().length >= MIN_JD_CHARS);
  readonly canMatch = computed(() => this.resumeReady() && this.jdReady() && !this.fileBusy());

  onDragOver(e: DragEvent): void { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave(): void { this.dragOver.set(false); }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  onFilePicked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readFile(file);
    input.value = '';
  }

  private async readFile(file: File): Promise<void> {
    this.introError.set('');
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      this.introError.set(`That file is over ${MAX_FILE_MB}MB — résumés are usually a lot lighter. 😅`);
      return;
    }
    this.fileBusy.set(true);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const text = isPdf ? await this.extractPdfText(file) : await file.text();
      this.fileBusy.set(false);
      this.acceptResume(text, file.name);
    } catch {
      this.fileBusy.set(false);
      this.introError.set("Couldn't read that file. Try a PDF or plain text — or just paste the résumé below.");
    }
  }

  /**
   * Client-side PDF → text via pdf.js. The raw PDF never leaves the browser —
   * only the extracted text is sent for matching.
   */
  private async extractPdfText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await task.promise;
    let out = '';
    const pages = Math.min(doc.numPages, 6);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out += tc.items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
    }
    void task.destroy();
    return out;
  }

  usePaste(): void {
    this.introError.set('');
    const text = this.pasteText().trim();
    if (text.length < MIN_RESUME_CHARS) {
      this.introError.set('That looks too short to be a résumé — paste the whole thing. 📄');
      return;
    }
    this.acceptResume(text, 'pasted text');
    this.pasteMode.set(false);
  }

  private acceptResume(text: string, source: string): void {
    const cleaned = text.replace(/\r/g, '').trim();
    if (cleaned.length < MIN_RESUME_CHARS) {
      this.introError.set("We couldn't find enough text in that file — try pasting the résumé instead.");
      return;
    }
    this.resumeText.set(cleaned);
    this.resumeSource.set(source);
  }

  /** "change" on the loaded chip — drop the résumé, keep the JD. */
  clearResume(): void {
    this.resumeText.set('');
    this.resumeSource.set('');
    this.pasteText.set('');
    this.introError.set('');
  }

  // ── Matching: run the report ────────────────────────────────
  runMatch(): void {
    if (!this.canMatch()) return;
    this.introError.set('');
    this.stage.set('matching');

    let i = 0;
    this.matchStatus.set(MATCH_STATUS[0]);
    if (isPlatformBrowser(this.platformId)) {
      this.statusTimer = setInterval(() => {
        i = (i + 1) % MATCH_STATUS.length;
        this.matchStatus.set(MATCH_STATUS[i]);
      }, 1600);
    }

    this.svc.match(this.resumeText(), this.jdText().trim()).subscribe({
      next: report => {
        this.stopStatusTimer();
        this.report.set(report);
        this.tipOpen.set(new Set());
        this.memeFailed.set(false);
        this.meme.set(this.memeSvc.forMatch(report.score, this.memeTag(report)));
        this.stage.set('results');
        this.animateScore(report.score);
      },
      error: (err: Error) => {
        this.stopStatusTimer();
        this.stage.set('intro');
        this.introError.set(err.message || 'The recruiter dozed off mid-read. Try again?');
      },
    });
  }

  private stopStatusTimer(): void {
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
  }

  /** Sweep the ring 0→score so the number lands with some drama. */
  private animateScore(target: number): void {
    if (!isPlatformBrowser(this.platformId)) { this.displayScore.set(target); return; }
    this.displayScore.set(0);
    const start = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.displayScore.set(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Results ─────────────────────────────────────────────────
  readonly verdictMeta = computed(() => VERDICT_META[this.report()?.verdict ?? 'partial']);
  readonly mustGaps = computed(() => (this.report()?.missing ?? []).filter(m => m.importance === 'must'));
  readonly niceGaps = computed(() => (this.report()?.missing ?? []).filter(m => m.importance === 'nice'));
  /** Ring circumference share — r=52 in the SVG. */
  readonly ringOffset = computed(() => {
    const c = 2 * Math.PI * 52;
    return c * (1 - this.displayScore() / 100);
  });

  /**
   * The skill this match hinged on — the top must-have gap when the screen
   * goes badly (the thing that blocked you), the top matched skill when it
   * goes well (the thing that carried you) — so the meme names YOUR result.
   */
  private memeTag(r: JdMatchReport): string {
    const blocked = r.verdict === 'partial' || r.verdict === 'weak';
    const gap = r.missing.find(m => m.importance === 'must') ?? r.missing[0];
    return (blocked
      ? gap?.skill || r.matched[0]?.skill
      : r.matched[0]?.skill || gap?.skill) ?? '';
  }

  onMemeError(): void { this.memeFailed.set(true); }

  toggleTip(key: string): void {
    this.tipOpen.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  isTipOpen(key: string): boolean { return this.tipOpen().has(key); }

  // ── Replay ──────────────────────────────────────────────────
  /** Same résumé, different posting. */
  tryAnotherJd(): void {
    this.jdText.set('');
    this.report.set(null);
    this.meme.set(null);
    this.stage.set('intro');
  }

  /** Full reset — new résumé and JD. */
  restart(): void {
    this.clearResume();
    this.jdText.set('');
    this.report.set(null);
    this.meme.set(null);
    this.stage.set('intro');
  }
}
