import { loadMetricCircuits, renderCircuitList } from './circuits'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('missing #app element')
}

const circuits = loadMetricCircuits()
const attribution = circuits[0]?.attribution

app.innerHTML = `
  <h1>circuit-finder</h1>
  <p>${circuits.length} circuits loaded. Lap length and longest straight are
  computed from the stored centreline geometry.</p>
  ${renderCircuitList(circuits)}
  ${
    attribution
      ? `<footer><small>Circuit geometry: ${attribution.source},
         <a href="${attribution.url}">${attribution.url}</a> (${attribution.license}).</small></footer>`
      : ''
  }
`
