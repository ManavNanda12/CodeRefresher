import {
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type EditorLang = 'typescript' | 'csharp' | 'sql';

/** Per-language placeholder so an empty editor still shows the user some basic syntax. */
const PLACEHOLDERS: Record<EditorLang, string> = {
  typescript: `// TypeScript — sketch a quick example\n@Component({ selector: 'app-demo' })\nexport class DemoComponent {\n  count = signal(0);\n}`,
  csharp: `// C# — sketch a quick example\npublic async Task<int> GetCountAsync()\n{\n    return await _repo.CountAsync();\n}`,
  sql: `-- SQL — write a query\nSELECT id, name\nFROM   users\nWHERE  active = 1;`,
};

/**
 * Lightweight CodeMirror 6 wrapper. Browser-only (CodeMirror touches the DOM, so it
 * never initialises during SSR). The editor is uncontrolled after init — it emits
 * (valueChange) on edits and re-syncs its doc when [value] changes from the outside
 * (e.g. the quiz navigates to a different question).
 */
@Component({
  selector: 'app-code-editor',
  template: `<div #host class="cm-host"></div>`,
  styleUrl: './code-editor.css',
})
export class CodeEditorComponent implements OnDestroy {
  private platformId = inject(PLATFORM_ID);

  language = input<EditorLang>('typescript');
  value = input<string>('');
  valueChange = output<string>();

  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private view: import('@codemirror/view').EditorView | null = null;
  /** Guards the effect so our own edits don't trigger a redundant doc replacement. */
  private syncing = false;

  constructor() {
    afterNextRender(() => this.init());

    // Keep the editor in sync when the parent swaps in another question's code.
    effect(() => {
      const v = this.value();
      if (this.view && !this.syncing && v !== this.view.state.doc.toString()) {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v } });
      }
    });
  }

  private async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const [{ EditorView, keymap, placeholder }, { EditorState }, { basicSetup }, { oneDark }, { indentWithTab }] =
      await Promise.all([
        import('@codemirror/view'),
        import('@codemirror/state'),
        import('codemirror'),
        import('@codemirror/theme-one-dark'),
        import('@codemirror/commands'),
      ]);

    const langExt = await this.langExtension();

    this.view = new EditorView({
      parent: this.host().nativeElement,
      state: EditorState.create({
        doc: this.value(),
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          langExt,
          oneDark,
          placeholder(PLACEHOLDERS[this.language()] ?? ''),
          EditorView.lineWrapping,
          EditorView.updateListener.of(u => {
            if (!u.docChanged) return;
            this.syncing = true;
            this.valueChange.emit(u.state.doc.toString());
            this.syncing = false;
          }),
          EditorView.theme({
            '&': { fontSize: '13px', backgroundColor: 'transparent' },
            '.cm-content': { minHeight: '130px', fontFamily: "'Fira Code', ui-monospace, monospace" },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    });
  }

  private async langExtension(): Promise<import('@codemirror/state').Extension> {
    switch (this.language()) {
      case 'sql': {
        const { sql } = await import('@codemirror/lang-sql');
        return sql();
      }
      case 'csharp': {
        const [{ StreamLanguage }, { csharp }] = await Promise.all([
          import('@codemirror/language'),
          import('@codemirror/legacy-modes/mode/clike'),
        ]);
        return StreamLanguage.define(csharp);
      }
      default: {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript({ typescript: true });
      }
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
