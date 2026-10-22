import type {
  AggregateRatingSimple,
  ArticleSimple,
  BookSimple,
  CourseSimple,
  EventSimple,
  HowToSimple,
  ImageSimple,
  JobPostingSimple,
  OfferSimple,
  OrganizationSimple,
  PersonSimple,
  PlaceSimple,
  ProductSimple,
  QuestionSimple,
  RecipeSimple,
  ReviewSimple,
  ServiceSimple,
  SoftwareAppSimple,
  VideoSimple,
  WebPageSimple,
} from "@unhead/schema-org";

/**
 * Camox's typed vocabulary of schema.org, which every `toStructuredData` returns nodes of. It is
 * built on the typed nodes of `@unhead/schema-org`, narrowed in three ways:
 *
 * - `@type` takes only the curated types search engines act on, listed in `NodeProperties`.
 * - Each type takes only the properties `@unhead/schema-org` names: there is no way out to the
 *   rest of schema.org.
 * - The properties search engines require are required, as `NodeRequirements` lists them. Each
 *   definition kind makes optional the ones Camox fills itself, through `Filled`.
 *
 * `WebSite` is never in the vocabulary: Camox alone emits it. Definitions that can't emit an
 * `Organization` exclude it through `Excluded`.
 */

/** The Article types. Their pages are articles in Open Graph too. */
export const ARTICLE_TYPES = [
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "ScholarlyArticle",
  "Report",
  "SocialMediaPosting",
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/** The kinds of web page a layout can say its pages are. */
export const WEB_PAGE_TYPES = [
  "AboutPage",
  "CheckoutPage",
  "CollectionPage",
  "ContactPage",
  "FAQPage",
  "ItemPage",
  "MedicalWebPage",
  "ProfilePage",
  "QAPage",
  "RealEstateListing",
  "SearchResultsPage",
] as const;
export type WebPageType = (typeof WEB_PAGE_TYPES)[number];

/** The curated types that are creative works, which pages contain rather than talk about. */
export const CREATIVE_WORK_TYPES = [
  ...ARTICLE_TYPES,
  "Book",
  "Course",
  "HowTo",
  "ImageObject",
  "Question",
  "Recipe",
  "Review",
  "SoftwareApplication",
  "VideoObject",
] as const satisfies readonly StructuredDataType[];

/** A type's own properties, without the index signature that would let any key through. */
type Known<T> = T extends unknown
  ? { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] }
  : never;

/** The given properties of a type, required. */
type Need<T, K extends keyof Known<T>> = { [P in K]-?: Exclude<Known<T>[P], undefined> };

/** Each curated `@type`, with the node whose properties it takes. */
type NodeProperties = { [T in ArticleType]: ArticleSimple } & {
  Product: ProductSimple;
  Offer: OfferSimple;
  Event: EventSimple;
  Person: PersonSimple;
  Place: PlaceSimple;
  Organization: OrganizationSimple;
  Review: ReviewSimple;
  AggregateRating: AggregateRatingSimple;
  Question: QuestionSimple;
  HowTo: HowToSimple;
  Recipe: RecipeSimple;
  Course: CourseSimple;
  JobPosting: JobPostingSimple;
  SoftwareApplication: SoftwareAppSimple;
  VideoObject: VideoSimple;
  ImageObject: ImageSimple;
  Book: BookSimple;
  Service: ServiceSimple;
};

/** Every `@type` a definition's nodes can have. */
export type StructuredDataType = keyof NodeProperties;

/** What search engines require of each type, including what Camox may fill in. */
type NodeRequirements = { [T in ArticleType]: Need<ArticleSimple, "headline"> } & {
  Product: Need<ProductSimple, "name"> &
    (
      | Need<ProductSimple, "offers">
      | Need<ProductSimple, "review">
      | Need<ProductSimple, "aggregateRating">
    );
  Offer: { price: number | string; priceCurrency: string };
  Event: Need<EventSimple, "name" | "startDate" | "location">;
  Person: Need<PersonSimple, "name">;
  Place: Need<PlaceSimple, "name">;
  Organization: Need<OrganizationSimple, "name">;
  Review: Need<ReviewSimple, "author">;
  AggregateRating: Need<AggregateRatingSimple, "ratingValue"> &
    (Need<AggregateRatingSimple, "ratingCount"> | Need<AggregateRatingSimple, "reviewCount">);
  Question: Need<QuestionSimple, "name" | "acceptedAnswer">;
  HowTo: Need<HowToSimple, "name" | "step">;
  Recipe: Need<RecipeSimple, "name" | "image">;
  Course: Need<CourseSimple, "name" | "description">;
  JobPosting: Need<JobPostingSimple, "title" | "description" | "datePosted" | "hiringOrganization">;
  SoftwareApplication: Need<SoftwareAppSimple, "name" | "offers"> &
    (Need<SoftwareAppSimple, "aggregateRating"> | Need<SoftwareAppSimple, "review">);
  VideoObject: Need<VideoSimple, "name" | "thumbnailUrl" | "uploadDate">;
  ImageObject: Need<ImageSimple, "contentUrl">;
  Book: Need<BookSimple, "name" | "author">;
  Service: Need<ServiceSimple, "name">;
};

/** Properties Camox sets on every node: its identity, and its link to its page. */
type CamoxOwned = "@type" | "@id" | "mainEntityOfPage";

/** A requirement, without the properties Camox fills. */
type Unfilled<Requirement, Filled extends PropertyKey> = Requirement extends unknown
  ? Omit<Requirement, Filled>
  : never;

type NodeOf<T extends StructuredDataType, Filled extends PropertyKey> = T extends unknown
  ? { "@type": T } & Partial<Omit<Known<NodeProperties[T]>, CamoxOwned>> &
      Unfilled<NodeRequirements[T], Filled>
  : never;

/**
 * A node of Camox's vocabulary. `Excluded` lists the types a definition can't emit, and `Filled`
 * the properties Camox fills when the definition leaves them out.
 */
export type StructuredDataNode<
  Excluded extends StructuredDataType = never,
  Filled extends PropertyKey = never,
> = NodeOf<Exclude<StructuredDataType, Excluded>, Filled>;

/** The properties Camox fills on a layout's main entity, from its page. */
export type MainEntityFilled =
  | "name"
  | "headline"
  | "description"
  | "url"
  | "image"
  | "datePublished"
  | "dateModified"
  | "publisher"
  | "inLanguage";

/** What a page is about, beside its own node. Only collections' records can be organizations. */
export type MainEntity = StructuredDataNode<"Organization", MainEntityFilled>;

/** What blocks and repeatable items describe: anything but an organization, as Camox emits the site's. */
export type BlockNode = StructuredDataNode<"Organization">;

declare const RepeatedNodesBrand: unique symbol;
/**
 * A repeater's token in a Structured Data template: its items' nodes, from their own template,
 * where the token is placed.
 */
export type RepeatedNodes = never[] & { readonly [RepeatedNodesBrand]: true };

/** What a block's or repeatable item's `toStructuredData` returns: one or more nodes. */
export type BlockStructuredData =
  | BlockNode
  | RepeatedNodes
  | ReadonlyArray<BlockNode | RepeatedNodes>;

/** Requires nothing of a list of nodes, or a node, that only take their types' properties. */
export type KnownNodesOnly<Nodes> = [Nodes] extends [readonly (infer Node)[]]
  ? KnownPropertiesOnly<Node, BlockNode>
  : KnownPropertiesOnly<Nodes, BlockNode>;

/** The page node's properties that Camox alone sets, from the page and the layout's outputs. */
type PageOwned =
  | CamoxOwned
  | "url"
  | "name"
  | "description"
  | "isPartOf"
  | "inLanguage"
  | "datePublished"
  | "dateModified"
  | "primaryImageOfPage"
  | "breadcrumb"
  | "mainEntity"
  | "potentialAction";

/** A kind of web page, merged into the page's node. */
export type WebPageKind = { "@type": WebPageType } & Partial<Omit<Known<WebPageSimple>, PageOwned>>;

/** What a layout's `toStructuredData` says its page is: a kind of web page, or a main entity. */
export type LayoutStructuredData = WebPageKind | MainEntity;

/** The members of a vocabulary a node of type `T` can be. */
type MembersOf<Vocabulary, T> = Vocabulary extends { "@type": infer U }
  ? T extends U
    ? Vocabulary
    : never
  : never;

/**
 * A node's keys that hold a value. TypeScript gives each object of a list the others' keys as
 * `?: undefined`, which say nothing.
 */
type SetKeys<Node> = {
  [K in keyof Node]-?: [Exclude<Node[K], undefined>] extends [never] ? never : K;
}[keyof Node];

/**
 * The properties of a node that its type doesn't take. Object literals returned by a function
 * escape TypeScript's excess property checks, so definitions infer their nodes and check them
 * with `KnownPropertiesOnly`.
 */
export type UnknownProperties<Node, Vocabulary> = Node extends { "@type": infer T }
  ? Exclude<SetKeys<Node>, keyof MembersOf<Vocabulary, T>>
  : never;

/** Requires nothing of a definition whose nodes only take their types' properties. */
export type KnownPropertiesOnly<Node, Vocabulary> = [UnknownProperties<Node, Vocabulary>] extends [
  never,
]
  ? unknown
  : {
      "❌ Camox: these structured data properties aren't in Camox's vocabulary": UnknownProperties<
        Node,
        Vocabulary
      >;
    };

const includes = <T extends string>(types: readonly T[], type: unknown): type is T =>
  types.includes(type as T);

/** Whether a node is a kind of web page. */
export const isWebPageKind = (node: { "@type": string }): node is WebPageKind =>
  includes(WEB_PAGE_TYPES, node["@type"]);

/** Whether a node is an Article. */
export const isArticle = (node: { "@type": string }): boolean =>
  includes(ARTICLE_TYPES, node["@type"]);

/** Whether a node is a creative work, rather than a thing a page talks about. */
export const isCreativeWork = (node: { "@type": string }): boolean =>
  includes(CREATIVE_WORK_TYPES, node["@type"]);
