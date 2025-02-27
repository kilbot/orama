import { autocomplete } from '@algolia/autocomplete-js'
import '@algolia/autocomplete-theme-classic/dist/theme.min.css'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment, @typescript-eslint/prefer-ts-expect-error
// @ts-ignore Will fail in CJS compilation
import { GlobalVersion, useActiveVersion, useVersions } from '@docusaurus/plugin-content-docs/client'
import { useColorMode, useDocsPreferredVersion } from '@docusaurus/theme-common'
import useBaseUrl from '@docusaurus/useBaseUrl'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { usePluginData } from '@docusaurus/useGlobalData'
import useIsBrowser from '@docusaurus/useIsBrowser'
import { create, load } from '@orama/orama'
import type { OramaWithHighlight, Position } from '@orama/plugin-match-highlight'
import { searchWithHighlight } from '@orama/plugin-match-highlight'
import { ungzip } from 'pako'
import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react'
import { render } from 'react-dom'
// @ts-expect-error Resolve at runtime
import { SearchNoResults } from '@theme/SearchNoResults'
// @ts-expect-error Resolve at runtime
import { SearchResults } from '@theme/SearchResults'
// @ts-expect-error Resolve at runtime
import { SearchResult } from '@theme/SearchResult'
import { Hit, INDEX_FILE, PLUGIN_NAME, PluginData, RawDataWithPositions, schema } from '../../../server/types.js'

export default function SearchBar(): JSX.Element {
  const isBrowser = useIsBrowser()
  const { siteConfig } = useDocusaurusContext()
  const containerRef = useRef(null)
  const { colorMode } = useColorMode()
  const { searchData } = usePluginData(PLUGIN_NAME) as PluginData
  const [database, setDatabase] = useState<OramaWithHighlight>()
  const searchBaseUrl = useBaseUrl(INDEX_FILE)
  const versions = useVersions(undefined)
  const activeVersion = useActiveVersion(undefined)
  const { preferredVersion } = useDocsPreferredVersion()

  const version = useMemo(() => {
    if (!isBrowser) {
      return undefined
    } else if (activeVersion) {
      return activeVersion
    } else if (preferredVersion) {
      return preferredVersion
    }

    // Fallback - Return the latest version or the first one existing
    return versions.find((v: GlobalVersion) => v.isLast) ?? versions[0]
  }, [isBrowser, activeVersion, preferredVersion, versions])

  useEffect(() => {
    if (!containerRef.current || !isBrowser || !database) {
      return undefined
    }

    const search = autocomplete({
      placeholder: 'Search ...',
      container: containerRef.current,
      // @ts-expect-error render typing here is for preact, react also works
      renderer: { createElement, Fragment, render },
      openOnFocus: true,
      detachedMediaQuery: '', // always detached
      async getSources({ query: term }): Promise<any> {
        return [
          {
            sourceId: 'orama',
            async getItems() {
              const results = await searchWithHighlight(database, {
                term,
                properties: ['sectionTitle', 'sectionContent', 'type']
              })

              const processed = results.hits.flatMap(hit =>
                Object.values((hit as any).positions.sectionContent).flatMap(positions =>
                  (positions as any).map((position: Position) => ({
                    ...hit,
                    position
                  }))
                )
              )

              return processed
            },
            getItemUrl({ item }: { item: Hit }) {
              return item.document.pageRoute
            },
            templates: {
              item({ item }: { item: Hit }) {
                return <SearchResult hit={item} />
              }
            }
          }
        ]
      },
      render({ sections, render }, root) {
        render(<SearchResults sections={sections} />, root)
      },
      renderNoResults({ render, state }, root) {
        render(<SearchNoResults query={state.query} />, root)
      }
    })
    return () => {
      search.destroy()
    }
  }, [isBrowser, siteConfig, database, colorMode])

  useEffect(() => {
    async function loadDatabase(version: GlobalVersion): Promise<void> {
      let buffer: ArrayBuffer

      if (searchData[version.name]) {
        buffer = searchData[version.name].data
      } else {
        const searchResponse = await fetch(searchBaseUrl.replace('@VERSION@', version.name))

        if (searchResponse.status === 0) {
          throw new Error(`Network error: ${await searchResponse.text()}`)
        } else if (searchResponse.status !== 200) {
          throw new Error(`HTTP error ${searchResponse.status}: ${await searchResponse.text()}`)
        }

        buffer = await searchResponse.arrayBuffer()
      }

      const deflated = ungzip(buffer, { to: 'string' })
      const data: RawDataWithPositions = JSON.parse(deflated)

      const db = (await create({ schema })) as OramaWithHighlight
      await load(db, data)
      db.data.positions = data.positions
      setDatabase(db)
    }

    if (!isBrowser || !version) {
      return
    }

    loadDatabase(version).catch(error => {
      console.error('Cannot load search index.', error)
    })
  }, [isBrowser, searchData, searchBaseUrl, version])

  useEffect(() => {
    colorMode === 'dark' ? document.body.classList.add(colorMode) : document.body.classList.remove('dark')
  }, [colorMode])

  return <div ref={containerRef} />
}
