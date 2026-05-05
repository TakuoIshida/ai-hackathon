import * as stylex from "@stylexjs/stylex";
import { Mail, Search } from "lucide-react";
import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: {
    maxWidth: "64rem",
    marginInline: "auto",
    paddingInline: space.lg,
    paddingBlock: space.xl,
    fontFamily: typography.fontFamilySans,
    color: colors.fg,
    display: "flex",
    flexDirection: "column",
    gap: space.xl,
  },
  pageHeader: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  pageTitle: {
    fontSize: typography.fontSize2xl,
    fontWeight: typography.fontWeightBold,
    margin: 0,
  },
  pageSubtitle: {
    fontSize: typography.fontSizeMd,
    color: colors.muted,
    margin: 0,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightSemibold,
    margin: 0,
    paddingBottom: space.xs,
    borderBottom: `1px solid ${colors.border}`,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))",
    gap: space.md,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: space.md,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
  },
  panelLabel: {
    fontSize: typography.fontSizeXs,
    color: colors.muted,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  panelRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
  },
  swatch: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: typography.fontSizeSm,
  },
  swatchChip: {
    width: "1.25rem",
    height: "1.25rem",
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
  },
  shadowChip: {
    width: "5rem",
    height: "3rem",
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
  },
  shadowSm: {
    boxShadow: shadow.sm,
  },
  shadowMd: {
    boxShadow: shadow.md,
  },
  shadowLg: {
    boxShadow: shadow.lg,
  },
  fontRow: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  fontXs: { fontSize: typography.fontSizeXs },
  fontSm: { fontSize: typography.fontSizeSm },
  fontMd: { fontSize: typography.fontSizeMd },
  fontLg: { fontSize: typography.fontSizeLg },
  fontXl: { fontSize: typography.fontSizeXl },
  font2xl: { fontSize: typography.fontSize2xl },
  font3xl: { fontSize: typography.fontSize3xl },
});

const colorSwatches: Array<{ name: string; value: string }> = [
  { name: "primary", value: colors.primary },
  { name: "primaryFg", value: colors.primaryFg },
  { name: "accent", value: colors.accent },
  { name: "border", value: colors.border },
  { name: "muted", value: colors.muted },
  { name: "info", value: colors.info },
  { name: "success", value: colors.success },
  { name: "warning", value: colors.warning },
  { name: "destructive", value: colors.destructive },
];

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div {...stylex.props(styles.panelRow)}>
      <Button onClick={() => toast({ title: "Default toast", description: "Hello!" })}>
        default
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: "Saved", variant: "success" })}>
        success
      </Button>
      <Button
        variant="destructive"
        onClick={() =>
          toast({ title: "Failed", description: "Server returned 500", variant: "destructive" })
        }
      >
        destructive
      </Button>
    </div>
  );
}

export default function DevComponents() {
  const [agreed, setAgreed] = React.useState(false);
  const [notify, setNotify] = React.useState(true);
  const [radio, setRadio] = React.useState("a");

  return (
    <TooltipProvider>
      <main {...stylex.props(styles.page)}>
        <header {...stylex.props(styles.pageHeader)}>
          <h1 {...stylex.props(styles.pageTitle)}>Components Showcase</h1>
          <p {...stylex.props(styles.pageSubtitle)}>
            Phase 0 component catalog (Tier-1 + Tier-2 + Toast) のリファレンス。
            開発者向けのページなので production の navigation には載せない。
          </p>
        </header>

        {/* Foundation */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Foundation</h2>
          <div {...stylex.props(styles.grid)}>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Colors</p>
              {colorSwatches.map((c) => (
                <div key={c.name} {...stylex.props(styles.swatch)}>
                  <span {...stylex.props(styles.swatchChip)} style={{ backgroundColor: c.value }} />
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Typography (font sizes)</p>
              <div {...stylex.props(styles.fontRow)}>
                <span {...stylex.props(styles.fontXs)}>xs — The quick brown fox</span>
                <span {...stylex.props(styles.fontSm)}>sm — The quick brown fox</span>
                <span {...stylex.props(styles.fontMd)}>md — The quick brown fox</span>
                <span {...stylex.props(styles.fontLg)}>lg — The quick brown fox</span>
                <span {...stylex.props(styles.fontXl)}>xl — The quick brown fox</span>
                <span {...stylex.props(styles.font2xl)}>2xl — The quick brown fox</span>
                <span {...stylex.props(styles.font3xl)}>3xl — The quick brown fox</span>
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Shadow</p>
              <div {...stylex.props(styles.panelRow)}>
                <div {...stylex.props(styles.shadowChip, styles.shadowSm)} />
                <div {...stylex.props(styles.shadowChip, styles.shadowMd)} />
                <div {...stylex.props(styles.shadowChip, styles.shadowLg)} />
              </div>
            </div>
          </div>
        </section>

        {/* Form */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Form</h2>
          <div {...stylex.props(styles.grid)}>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Button — variant</p>
              <div {...stylex.props(styles.panelRow)}>
                <Button>primary</Button>
                <Button variant="secondary">secondary</Button>
                <Button variant="outline">outline</Button>
                <Button variant="ghost">ghost</Button>
                <Button variant="destructive">destructive</Button>
              </div>
              <p {...stylex.props(styles.panelLabel)}>Button — size / loading / icons</p>
              <div {...stylex.props(styles.panelRow)}>
                <Button size="sm">sm</Button>
                <Button size="md">md</Button>
                <Button size="lg">lg</Button>
                <Button loading>loading</Button>
                <Button leftIcon={<Mail size={14} />}>Email</Button>
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Input</p>
              <Label htmlFor="dev-email" required helperText="形式: name@example.com">
                Email
              </Label>
              <Input id="dev-email" placeholder="you@example.com" />
              <Input placeholder="error" error />
              <Input placeholder="search" leftAddon={<Search size={14} />} rightAddon=".com" />
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Textarea</p>
              <Textarea placeholder="メモ" />
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Select</p>
              <Select defaultValue="tokyo">
                <SelectTrigger>
                  <SelectValue placeholder="タイムゾーン" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tokyo">Asia/Tokyo</SelectItem>
                  <SelectItem value="utc">UTC</SelectItem>
                  <SelectItem value="ny">America/New_York</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Checkbox / Switch</p>
              <div {...stylex.props(styles.panelRow)}>
                <Checkbox
                  aria-label="agree"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(v === true)}
                />
                <span>同意する</span>
              </div>
              <div {...stylex.props(styles.panelRow)}>
                <Switch aria-label="notify" checked={notify} onCheckedChange={setNotify} />
                <span>通知</span>
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>RadioGroup</p>
              <RadioGroup value={radio} onValueChange={setRadio} aria-label="opts">
                <div {...stylex.props(styles.panelRow)}>
                  <RadioGroupItem value="a" aria-label="A" /> <span>A</span>
                </div>
                <div {...stylex.props(styles.panelRow)}>
                  <RadioGroupItem value="b" aria-label="B" /> <span>B</span>
                </div>
              </RadioGroup>
            </div>
          </div>
        </section>

        {/* Display */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Display</h2>
          <div {...stylex.props(styles.grid)}>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Avatar</p>
              <div {...stylex.props(styles.panelRow)}>
                <Avatar size="sm">
                  <AvatarFallback>SM</AvatarFallback>
                </Avatar>
                <Avatar size="md">
                  <AvatarFallback>MD</AvatarFallback>
                </Avatar>
                <Avatar size="lg">
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Badge</p>
              <div {...stylex.props(styles.panelRow)}>
                <Badge>default</Badge>
                <Badge variant="primary">primary</Badge>
                <Badge variant="outline">outline</Badge>
                <Badge variant="info">info</Badge>
                <Badge variant="success">success</Badge>
                <Badge variant="warning">warning</Badge>
                <Badge variant="destructive">destructive</Badge>
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Separator</p>
              <span>top</span>
              <Separator />
              <span>bottom</span>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Description text</CardDescription>
              </CardHeader>
              <CardBody>
                <p>Body content. Card has default / elevated / outline variants.</p>
              </CardBody>
              <CardFooter>
                <Button variant="outline">Cancel</Button>
                <Button>Save</Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        {/* Feedback */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Feedback</h2>
          <div {...stylex.props(styles.grid)}>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Spinner</p>
              <div {...stylex.props(styles.panelRow)}>
                <Spinner size="sm" />
                <Spinner size="md" />
                <Spinner size="lg" />
              </div>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Skeleton</p>
              <Skeleton style={{ height: "1rem", width: "100%" }} />
              <Skeleton style={{ height: "1rem", width: "80%" }} />
              <Skeleton style={{ height: "1rem", width: "60%" }} />
            </div>
            <Alert variant="info">
              <AlertTitle>Info</AlertTitle>
              <AlertDescription>This is an informational alert.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>Saved successfully.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>Heads up — verify before submit.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>Something went wrong.</AlertDescription>
            </Alert>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Toast</p>
              <ToastDemo />
            </div>
          </div>
        </section>

        {/* Overlay */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Overlay</h2>
          <div {...stylex.props(styles.grid)}>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Dialog</p>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogTitle>Confirm</DialogTitle>
                  <DialogDescription>本当に削除しますか?</DialogDescription>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Delete</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>DropdownMenu</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">Open menu</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem>Edit</DropdownMenuItem>
                  <DropdownMenuItem>Duplicate</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger">Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div {...stylex.props(styles.panel)}>
              <p {...stylex.props(styles.panelLabel)}>Tooltip</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip text</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </section>

        {/* Navigation */}
        <section {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>Navigation</h2>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p>Overview content</p>
            </TabsContent>
            <TabsContent value="settings">
              <p>Settings content</p>
            </TabsContent>
            <TabsContent value="members">
              <p>Members content</p>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </TooltipProvider>
  );
}
