"""首条 Web 链路的内容配置；字段类型、范围和跨表引用由后端统一校验。"""
import math
from typing import Literal

from pydantic import Field, model_validator

from core.game_project_models import Contract, Identifier, Text, Title


class ContentField(Contract):
    id: Identifier
    title: Title
    type: Literal['string', 'number', 'integer', 'boolean', 'enum', 'reference', 'asset']
    required: bool = True
    unique: bool = False
    minimum: float | None = Field(default=None, allow_inf_nan=False)
    maximum: float | None = Field(default=None, allow_inf_nan=False)
    options: list[Title] = Field(default_factory=list, max_length=100)
    referenceDataset: Literal['characters', 'enemies', 'levels'] | None = None

    @model_validator(mode='after')
    def constraints(self):
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError('最小值不能超过最大值')
        if self.type not in ('number', 'integer') and (self.minimum is not None or self.maximum is not None):
            raise ValueError('只有数值字段可设上下限')
        if self.type == 'enum':
            if not self.options or len(set(self.options)) != len(self.options):
                raise ValueError('枚举选项不能为空或重复')
        elif self.options:
            raise ValueError('非枚举字段不能设置选项')
        if (self.type == 'reference') != (self.referenceDataset is not None):
            raise ValueError('引用字段必须明确目标数据集')
        return self


class ContentRow(Contract):
    id: Identifier
    values: dict[str, str | int | float | bool | None] = Field(max_length=100)


class ContentDataset(Contract):
    datasetId: Literal['characters', 'enemies', 'levels']
    schemaVersion: Literal[1] = 1
    revision: int = Field(ge=1)
    fields: list[ContentField] = Field(min_length=1, max_length=100)
    rows: list[ContentRow] = Field(max_length=1000)

    @model_validator(mode='after')
    def values_valid(self):
        fields = {f.id: f for f in self.fields}
        if len(fields) != len(self.fields) or len({r.id for r in self.rows}) != len(self.rows):
            raise ValueError('行或字段 ID 重复')
        for row in self.rows:
            if set(row.values) - fields.keys():
                raise ValueError(f'{self.datasetId}/{row.id} 包含未知字段')
            for name, field in fields.items():
                value = row.values.get(name)
                location = f'{self.datasetId}/{row.id}/{name}'
                if value is None:
                    if field.required:
                        raise ValueError(f'{location} 必填')
                    continue
                if field.type in ('string', 'enum', 'reference', 'asset'):
                    if type(value) is not str or not value or len(value) > 20000:
                        raise ValueError(f'{location} 必须是非空文本')
                    if field.type == 'enum' and value not in field.options:
                        raise ValueError(f'{location} 不属于枚举选项')
                elif field.type == 'boolean':
                    if type(value) is not bool:
                        raise ValueError(f'{location} 必须为布尔值')
                else:
                    if type(value) not in (int, float) or (field.type == 'integer' and type(value) is not int):
                        raise ValueError(f'{location} 数值类型不匹配')
                    if not math.isfinite(value):
                        raise ValueError(f'{location} 数值必须有限')
                    if ((field.minimum is not None and value < field.minimum)
                            or (field.maximum is not None and value > field.maximum)):
                        raise ValueError(f'{location} 超出上下限')
        for field in self.fields:
            values = [r.values[field.id] for r in self.rows if r.values.get(field.id) is not None]
            if field.unique and len(set(values)) != len(values):
                raise ValueError(f'{self.datasetId}/{field.id} 必须唯一')
        return self


class GameContent(Contract):
    schemaVersion: Literal[1] = 1
    datasets: list[ContentDataset] = Field(min_length=3, max_length=3)

    @model_validator(mode='after')
    def references(self):
        tables = {d.datasetId: d for d in self.datasets}
        if set(tables) != {'characters', 'enemies', 'levels'}:
            raise ValueError('首版必须包含角色、敌人和关卡三个数据集')
        for table in self.datasets:
            for field in table.fields:
                if field.type != 'reference':
                    continue
                targets = {r.id for r in tables[field.referenceDataset].rows}
                for row in table.rows:
                    value = row.values.get(field.id)
                    if value is not None and value not in targets:
                        raise ValueError(f'{table.datasetId}/{row.id}/{field.id} 引用不存在：{value}')
        return self

    def validate_assets(self, asset_ids):
        for table in self.datasets:
            for row in table.rows:
                for field in table.fields:
                    value = row.values.get(field.id)
                    if field.type == 'asset' and value is not None and value not in asset_ids:
                        raise ValueError(f'{table.datasetId}/{row.id}/{field.id} 资产不存在：{value}')


def initial_content():
    return GameContent.model_validate(dict(datasets=[
        dict(datasetId='characters', revision=1, fields=[
            dict(id='speed', title='移动速度', type='number', minimum=0, maximum=2000),
            dict(id='hp', title='生命值', type='integer', minimum=1, maximum=10000),
            dict(id='spriteAsset', title='角色运行图', type='asset', required=False),
        ], rows=[dict(id='player', values=dict(speed=160, hp=3))]),
        dict(datasetId='enemies', revision=1, fields=[
            dict(id='speed', title='移动速度', type='number', minimum=0, maximum=2000),
            dict(id='damage', title='接触伤害', type='integer', minimum=0, maximum=10000),
        ], rows=[dict(id='slime', values=dict(speed=70, damage=1))]),
        dict(datasetId='levels', revision=1, fields=[
            dict(id='target', title='收集目标', type='integer', minimum=1, maximum=1000),
            dict(id='enemy', title='敌人类型', type='reference', referenceDataset='enemies'),
            *[dict(id=name, title=title, type='asset', required=False) for name,title in (
                ('backgroundAsset','关卡背景'),('itemAsset','收集物'),('enemyAsset','敌人图'),('healthAsset','生命图标'))],
        ], rows=[dict(id='first', values=dict(target=5, enemy='slime'))]),
    ]))
