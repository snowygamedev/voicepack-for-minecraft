import { useEffect } from 'react'
import type { JSX, ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}

export default function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-2xl'
}: ModalProps): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-full w-full ${width} flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl`}
        // The backdrop closes on click; the panel must not forward that click.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button className="btn-ghost px-2 py-0.5 text-lg leading-none" onClick={onClose}>
            &times;
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-ink-800 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
