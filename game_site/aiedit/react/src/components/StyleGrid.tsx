import { MULTI_SELECT_BASE, STYLE_NAMES, STYLE_ALT } from '../constants'

interface Props {
  selected: Set<string>
  onToggle: (name: string) => void
}

export default function StyleGrid({ selected, onToggle }: Props) {
  return (
    <div className="grid-container">
      {STYLE_NAMES.map(name => (
        <div key={name} className="grid-item">
          <a
            className={selected.has(name) ? 'active' : ''}
            onClick={() => onToggle(name)}
            style={{ cursor: 'pointer' }}
          >
            <img
              src={`${MULTI_SELECT_BASE}/${name}`}
              className="style"
              alt={STYLE_ALT[name] ?? name}
            />
          </a>
        </div>
      ))}
    </div>
  )
}
