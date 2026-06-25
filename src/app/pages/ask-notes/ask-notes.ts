import { Component, OnDestroy, PLATFORM_ID, inject, signal, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RagService } from '../../core/services/rag.service';
import { UserService } from '../../core/services/user.service';

type View = 'empty-initial' | 'empty-ready' | 'thinking' | 'answer';

interface Source {
  n: number;
  text: string;
}

@Component({
  selector: 'app-ask-notes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ask-notes.html',
  styleUrl: './ask-notes.css',
})
export class AskNotesComponent implements OnDestroy {
  private rag = inject(RagService);
  private user = inject(UserService);
  private platformId = inject(PLATFORM_ID);

  constructor() {
    // Notes persist server-side (Vectorize) across refreshes. Restore the saved
    // count from localStorage so the UI remembers the user already has notes —
    // otherwise it wrongly blocks "Ask" after a refresh.
    const n = this.readSavedCount();
    if (n > 0) {
      this.savedCount.set(n);
      this.showCountChip.set(true);
      this.view.set('empty-ready');
    }
  }

  // ── notes panel ──
  notesText = signal(
    'Call unsubscribe in ngOnDestroy, or use takeUntilDestroyed, to clean up Observable subscriptions.\n' +
      'Use trackBy in @for loops so Angular reuses DOM nodes instead of re-rendering the whole list.\n' +
      'OnPush change detection makes Angular re-check a component only when its inputs change.',
  );
  charCount = computed(() => this.notesText().length);
  detectedNotes = computed(() => this.parseNotes(this.notesText()));
  noteCount = computed(() => this.detectedNotes().length);

  savedCount = signal(0);
  showCountChip = signal(false);
  saving = signal(false);
  showPill = signal(false);
  pillText = signal('');
  shakeNotes = signal(false);

  // ── ask panel ──
  question = signal('');
  asking = signal(false);

  // ── answer area ──
  view = signal<View>('empty-initial');
  answerFull = signal('');
  displayedAnswer = signal('');
  sources = signal<Source[]>([]);
  noMatch = signal(false);

  isTyping = computed(() => this.displayedAnswer().length < this.answerFull().length);

  private revealTimer: ReturnType<typeof setInterval> | null = null;

  // ── notes parsing: one note per non-empty line ──
  private parseNotes(raw: string): string[] {
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  }

  onSave(): void {
    const notes = this.detectedNotes();
    if (notes.length === 0) {
      this.shakeNotes.set(true);
      setTimeout(() => this.shakeNotes.set(false), 600);
      return;
    }
    this.saving.set(true);
    this.rag.ingest(notes).subscribe((res) => {
      this.saving.set(false);
      const count = res.ingested || notes.length;
      this.savedCount.set(count);
      this.writeSavedCount(count);
      this.showCountChip.set(true);
      this.pillText.set(`${count} ${count === 1 ? 'note' : 'notes'} saved`);
      // restart the pop animation
      this.showPill.set(false);
      setTimeout(() => this.showPill.set(true), 20);
      if (this.view() === 'empty-initial') this.view.set('empty-ready');
    });
  }

  onAsk(): void {
    const q = this.question().trim();
    if (!q || this.asking()) return;

    if (this.savedCount() === 0) {
      this.answerFull.set('Save some notes first — I can only answer from your own saved notes.');
      this.displayedAnswer.set(this.answerFull());
      this.sources.set([]);
      this.noMatch.set(true);
      this.view.set('answer');
      return;
    }

    this.asking.set(true);
    this.view.set('thinking');

    this.rag.ask(q).subscribe((res) => {
      this.asking.set(false);
      this.noMatch.set(!!res.noMatch || (res.sources?.length ?? 0) === 0);
      this.sources.set((res.sources ?? []).map((text, i) => ({ n: i + 1, text })));
      this.answerFull.set(res.answer ?? '');
      this.view.set('answer');
      this.typeReveal(res.answer ?? '');
    });
  }

  onQuestionKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.onAsk();
    }
  }

  onNotesKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.onSave();
    }
  }

  /** Short label for a source chip. */
  shortSource(text: string): string {
    return text.length > 46 ? text.slice(0, 44).trim() + '…' : text;
  }

  // ── typewriter reveal (respects reduced motion) ──
  private typeReveal(text: string): void {
    if (this.revealTimer) clearInterval(this.revealTimer);
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !text) {
      this.displayedAnswer.set(text);
      return;
    }
    this.displayedAnswer.set('');
    const speed = Math.max(6, Math.min(22, Math.floor(900 / text.length)));
    let i = 0;
    this.revealTimer = setInterval(() => {
      i += 2;
      this.displayedAnswer.set(text.slice(0, i));
      if (i >= text.length && this.revealTimer) {
        clearInterval(this.revealTimer);
        this.revealTimer = null;
      }
    }, speed);
  }

  // ── persist saved-count per user, so refresh doesn't forget ──
  private storageKey(): string {
    return `cr:asknotes:count:${this.user.userId() ?? 'anon'}`;
  }
  private readSavedCount(): number {
    if (!isPlatformBrowser(this.platformId)) return 0;
    const raw = localStorage.getItem(this.storageKey());
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  private writeSavedCount(n: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(this.storageKey(), String(n));
  }

  ngOnDestroy(): void {
    if (this.revealTimer) clearInterval(this.revealTimer);
  }
}
