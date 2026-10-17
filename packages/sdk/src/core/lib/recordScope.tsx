import * as React from "react";

import { useLocation } from "../../features/navigation/navigation";
import { resolveAssetValue, useNormalizedData } from "../../lib/normalized-data";
import { useViewPages } from "../../lib/view-pages";
import { fieldPlainText } from "../recordItem";
import type { FileValue, ImageValue } from "./contentType";
import { renderImagePlaceholder } from "./imagePlaceholder";
import {
  buildImageSrcSet,
  getDefaultImageSizes,
  getDefaultImageWidth,
  transformImageUrl,
} from "./imageTransform";
import { markdownToReactNodes } from "./lexicalReact";
import type { ReferenceRecord } from "./reference";

/**
 * Read-only rendering of a record outside any block: the record a record page renders, and the
 * records it links. Fields have no overlays and no selection.
 */
interface RecordScopeValue {
  content: Record<string, unknown>;
  properties: Record<string, any>;
}

const RecordContext = React.createContext<RecordScopeValue | null>(null);

function useFieldValue(name: string) {
  const record = React.use(RecordContext);
  if (!record) throw new Error("Record fields must be used within layout.Item");
  return record.content[name];
}

const Field = ({ name, textStyle, linkStyle, children }: any) => {
  const value = useFieldValue(name);
  const pages = useViewPages();
  const pathname = useLocation({ select: (location) => location.pathname });
  return children(
    {
      children: markdownToReactNodes(value, {
        pages: pages,
        fallbackHref: pathname,
        textStyle,
        linkStyle,
      }),
    },
    { text: fieldPlainText(value) },
  );
};

function renderImage(value: ImageValue, children: any) {
  return renderImagePlaceholder(
    value,
    children(
      {
        src: transformImageUrl(value.url, {
          width: getDefaultImageWidth(),
          mimeType: value.mimeType,
          size: value.size,
        }),
        srcSet: buildImageSrcSet(value.url, value.mimeType, value.size),
        sizes: getDefaultImageSizes(),
        alt: value.alt,
      },
      value,
    ),
  );
}

function renderFile(value: FileValue, children: any) {
  return children({ href: value.url, download: value.filename }, value);
}

/** An asset field's value; unset assets render nothing rather than a fabricated default. */
function useAsset(name: string) {
  const { filesMap } = useNormalizedData();
  const value = useFieldValue(name);
  return value == null ? null : resolveAssetValue(value, filesMap);
}

const Image = ({ name, children }: any) => {
  const value = useAsset(name);
  return value ? renderImage(value as ImageValue, children) : null;
};

const File = ({ name, children }: any) => {
  const value = useAsset(name);
  return value ? renderFile(value as FileValue, children) : null;
};

const Embed = ({ name, children }: any) => {
  const value = useFieldValue(name);
  const url = typeof value === "string" ? value : "";
  return children({ src: url }, { url });
};

function useAssetList(name: string) {
  const { filesMap } = useNormalizedData();
  const value = useFieldValue(name);
  if (!Array.isArray(value)) return [];
  return value.map((asset) => resolveAssetValue(asset, filesMap)).filter(Boolean);
}

const ImageList = ({ name, children }: any) =>
  useAssetList(name).map((value, index) => (
    <React.Fragment key={index}>{renderImage(value as ImageValue, children)}</React.Fragment>
  ));

const FileList = ({ name, children }: any) =>
  useAssetList(name).map((value, index) => (
    <React.Fragment key={index}>{renderFile(value as FileValue, children)}</React.Fragment>
  ));

/** The records a first-hop record links, by field: one record (or null), or a list. */
type LinkedRecords = ReferenceRecord["references"];

const LinksContext = React.createContext<LinkedRecords>(undefined);

function useLinked(name: string) {
  const record = React.use(RecordContext);
  const links = React.use(LinksContext);
  const schema = record?.properties[name];
  return { schema, linked: links?.[name] };
}

const Reference = ({ name, children }: any) => {
  const { schema, linked } = useLinked(name);
  if (!linked || Array.isArray(linked) || linked.collectionId !== schema?.collectionId) return null;
  return (
    <RecordScope record={linked} properties={schema.referenceSchema.properties} hop={2}>
      {children}
    </RecordScope>
  );
};

const ReferenceList = ({ name, children }: any) => {
  const { schema, linked } = useLinked(name);
  if (!Array.isArray(linked)) return null;
  return linked
    .filter((record) => record.collectionId === schema?.collectionId)
    .map((record) => (
      <RecordScope
        key={record.id}
        record={record}
        properties={schema.referenceSchema.properties}
        hop={2}
      >
        {children}
      </RecordScope>
    ));
};

/**
 * Renders `record` with its typed scope. The first hop also renders the records it links
 * (the second hop), which link nothing further.
 */
export function RecordScope({
  record,
  properties,
  hop,
  children,
}: {
  record: Pick<ReferenceRecord, "id" | "label" | "content" | "references">;
  properties: Record<string, any>;
  hop: 1 | 2;
  children: (scope: any) => React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ content: record.content, properties }),
    [record.content, properties],
  );
  return (
    <RecordContext.Provider value={value}>
      <LinksContext.Provider value={hop === 1 ? record.references : undefined}>
        {children({
          id: record.id,
          label: record.label,
          Field,
          Image,
          File,
          Embed,
          ImageList,
          FileList,
          ...(hop === 1 ? { Reference, ReferenceList } : {}),
        })}
      </LinksContext.Provider>
    </RecordContext.Provider>
  );
}
