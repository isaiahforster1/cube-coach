import type { ReactElement } from 'react';

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'email' | 'password';
  readonly autoComplete?: string;
  readonly error?: string | undefined;
  readonly required?: boolean;
}

/**
 * A labelled text input.
 *
 * The accessibility here is not decoration. `htmlFor` ties the label to the input, so
 * clicking the label focuses it and a screen reader announces what the field is for.
 * `aria-invalid` and `aria-describedby` connect the error message to the field, so the
 * error is read out when focus lands there — rather than being red text a sighted mouse
 * user happens to notice.
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  error,
  required = true,
}: TextFieldProps): ReactElement {
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>

      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 aria-invalid:border-red-500"
      />

      {error !== undefined && (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
