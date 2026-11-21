/** Big banner whenever data is a sample (§9.2) or not final (§7.4). Never removable on stage. */
export function SampleBanner({ show, text = 'SAMPLE DATA' }: { show: boolean; text?: string }) {
  return show ? <div className="sample-banner">{text}</div> : null
}
