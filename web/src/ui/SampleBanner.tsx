/** Big banner whenever data is a sample (spec §9.2). Never removable on stage. */
export function SampleBanner({ show }: { show: boolean }) {
  return show ? <div className="sample-banner">SAMPLE DATA</div> : null
}
