import { PageHeader } from '../../components/layout';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';

/**
 * SPACE (ADR-062). The data is in place; its screen (tree, pages, tables)
 * arrives in a later phase. Until then this says what SPACE is and how much
 * is already there.
 */
export function SpacePage() {
  useDocumentTitle('SPACE');
  const { space } = useRepositories();
  const nodes = useWatch(space.watchAll);
  const documents =
    nodes.status === 'ready' ? nodes.data.filter((n) => n.kind !== 'section').length : undefined;
  return (
    <>
      <PageHeader
        title="SPACE"
        description="Your project knowledge, notes and documents live here."
      />
      <p className="mt-6 text-sm text-fg-muted" role="status">
        {documents === undefined
          ? ''
          : documents === 0
            ? 'Nothing here yet.'
            : `${documents} ${documents === 1 ? 'page or table' : 'pages and tables'} so far. Browsing them arrives with SPACE’s own screen.`}
      </p>
    </>
  );
}
