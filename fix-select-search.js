const fs = require('fs');
const file = 'src/app/(dashboard)/inventory/damages/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add new imports
const extraImports = `
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
`;
content = content.replace('import { format } from "date-fns";', extraImports + 'import { format } from "date-fns";');

// 2. Add popover state
content = content.replace(
    'const [isSubmitting, setIsSubmitting] = useState(false);',
    'const [isSubmitting, setIsSubmitting] = useState(false);\n    const [openPopover, setOpenPopover] = useState(false);'
);

// 3. Replace Select with Popover/Command
const oldSelectBlock = `                                <Select value={formData.variant_id} onValueChange={(val) => setFormData({...formData, variant_id: val})}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select product" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {variants.map(v => (
                                            <SelectItem key={v.id} value={v.id}>
                                                {v.products?.name} - {v.title} ({formatCurrency(v.cost_price)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>`;

const newComboboxBlock = `                                <Popover open={openPopover} onOpenChange={setOpenPopover}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={openPopover}
                                            className="justify-between w-full font-normal"
                                        >
                                            {formData.variant_id
                                                ? (() => {
                                                    const v = variants.find((variant) => variant.id === formData.variant_id);
                                                    return v ? \`\${v.products?.name} - \${v.title} (\${formatCurrency(v.cost_price)})\` : "Select product...";
                                                })()
                                                : "Search product..."}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="Search by name..." />
                                            <CommandList>
                                                <CommandEmpty>No product found.</CommandEmpty>
                                                <CommandGroup>
                                                    {variants.map((v) => (
                                                        <CommandItem
                                                            key={v.id}
                                                            value={\`\${v.products?.name} \${v.title}\`}
                                                            onSelect={() => {
                                                                setFormData({ ...formData, variant_id: v.id });
                                                                setOpenPopover(false);
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    formData.variant_id === v.id ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            {v.products?.name} - {v.title} ({formatCurrency(v.cost_price)})
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>`;

content = content.replace(oldSelectBlock, newComboboxBlock);

fs.writeFileSync(file, content);
