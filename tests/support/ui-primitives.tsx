/**
 * Test double of `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The production bundle externalizes that package to the shell's copy — the web
 * shell seeds it in its module table, so inlining it would give this plugin a
 * second instance of shared UI state. Under Vitest there is no shell, so the
 * package resolves to its published `lib/`, which imports `*.module.css` that
 * Node cannot load and pulls an undeclared 22-package graph (shiki, katex,
 * micromark, simple-icons) that a sidebar panel has no use for.
 *
 * These controls are the whole surface this plugin uses, and each is faithful
 * enough for the page specs to assert against: `Button` is a real `<button>` so
 * `disabled` propagation is genuinely under test, `Modal` is a real `dialog`
 * carrying its title and close label so the add-model specs can find it by role,
 * and the rest carry the children and ARIA the page relies on.
 */
import type { ReactNode } from 'react'

/** Props the page passes to the shared button. */
export interface ButtonProps {
  readonly variant?: 'primary' | 'outline'
  readonly size?: 'sm' | 'md'
  readonly icon?: ReactNode
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly children?: ReactNode
  readonly 'aria-label'?: string
}

/** A real button, so disabled and accessible-name assertions test real DOM. */
export function Button({ variant = 'primary', size = 'md', icon, disabled, onClick, children, ...rest }: ButtonProps): ReactNode {
  return (
    <button type="button" data-variant={variant} data-size={size} disabled={disabled} onClick={onClick} {...rest}>
      {icon}
      {children}
    </button>
  )
}

/** Props the page passes to the shared capsule badge. */
export interface TagProps {
  readonly tone?: string
  readonly className?: string
  readonly children?: ReactNode
}

/** A badge carrying its tone as data, matching the real component's contract. */
export function Tag({ tone = 'outline', className, children }: TagProps): ReactNode {
  return <span className={className} data-tone={tone}>{children}</span>
}

/** States the page renders a dot for. */
export type StateDotState = 'pending' | 'running' | 'done' | 'warning' | 'error'

/** Props the page passes to the shared status dot. */
export interface StateDotProps {
  readonly appearance?: string
  readonly state?: StateDotState
}

/** A dot the specs identify by role; the page never asserts on its appearance. */
export function StateDot({ appearance = 'step', state = 'pending' }: StateDotProps): ReactNode {
  return <span role="img" aria-hidden="true" data-appearance={appearance} data-state={state} />
}

/** Shared props for the icon components the page uses. */
export interface IconProps {
  readonly size?: number
  readonly className?: string
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
}

/** The disclosure chevron. */
export function IconChevronDownOutlineRegular({ size = 16, className, ...rest }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} {...rest} />
}

/** The refresh glyph on the re-query button. */
export function IconRefreshOutlineRegular({ size = 16, className, ...rest }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} {...rest} />
}

/** The plus glyph on the add-model button. */
export function IconPlusOutlineRegular({ size = 16, className, ...rest }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} {...rest} />
}

/** The pencil glyph on the edit-model button. */
export function IconEditOutlineRegular({ size = 16, className, ...rest }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} {...rest} />
}

/** The bin glyph on the remove-model button. */
export function IconTrashOutlineRegular({ size = 16, className, ...rest }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} {...rest} />
}

/** Props the page passes to the shared text field. */
export interface InputProps {
  readonly icon?: ReactNode
  readonly className?: string
  readonly id?: string
  readonly value?: string
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly inputMode?: 'numeric' | 'text'
  readonly 'data-modal-autofocus'?: true
  readonly onChange?: (event: { target: { value: string } }) => void
  readonly onKeyDown?: (event: { key: string; preventDefault: () => void }) => void
}

/** A controlled native input, so value and change propagation are genuinely under test. */
export function Input({ icon, className, onChange, onKeyDown, ...rest }: InputProps): ReactNode {
  return (
    <span className={className}>
      {icon}
      <input
        id={rest.id}
        type="text"
        value={rest.value ?? ''}
        disabled={rest.disabled}
        placeholder={rest.placeholder}
        inputMode={rest.inputMode}
        data-modal-autofocus={rest['data-modal-autofocus'] === true ? '' : undefined}
        onChange={event => { onChange?.({ target: { value: event.target.value } }) }}
        onKeyDown={event => { onKeyDown?.({ key: event.key, preventDefault: () => { event.preventDefault() } }) }}
      />
    </span>
  )
}

/** Props the page passes to the shared labeled checkbox. */
export interface CheckboxProps {
  readonly checked?: boolean
  readonly onChange?: (next: boolean) => void
  readonly label: string
  readonly disabled?: boolean
  readonly title?: string
  readonly className?: string
}

/** A native checkbox inside its label, matching the real control's contract. */
export function Checkbox({ checked = false, onChange, label, disabled, title, className }: CheckboxProps): ReactNode {
  return (
    <label className={className} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => { onChange?.(event.target.checked) }}
      />
      {label}
    </label>
  )
}

/** Props the page passes to the shared dialog. */
export interface ModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly closeLabel?: string
  readonly description?: string
  readonly children?: ReactNode
  readonly footer?: ReactNode
}

/**
 * A real `role="dialog"` carrying the title as its accessible name, so the
 * specs can open and identify the add-model dialog exactly as the reader does.
 * The portal and focus handling the real control owns are not under test here.
 */
export function Modal({ open, onClose, title, closeLabel, description, children, footer }: ModalProps): ReactNode {
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={title}>
      {closeLabel === undefined ? null : (
        <button type="button" aria-label={closeLabel} onClick={onClose} />
      )}
      {description === undefined ? null : <p>{description}</p>}
      {children}
      {footer}
    </div>
  )
}
